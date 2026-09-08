-- ============================================================================
-- Reacting to a pick.
--
-- The draft is the loudest ninety minutes of the year and the only room in the
-- app where nobody could say anything. The House has reactions on every line;
-- the board had grades — Steal, Reach, Big reach, computed and rendered in
-- three places — and no way for eleven people to agree or disagree with one.
--
-- The same reactions table, one more source. Not a second mechanism: a pick is
-- a thing that happened in a league, exactly like a signing or a trade, and
-- the row shape, the fixed palette, the toggle and the "including you" tally
-- all already exist and already work.
--
-- Keyed on the draft pick's own id, not the player's. A player can be taken in
-- this year's draft and next year's, and in a mock; the pick is the event that
-- got the reaction, and it is the pick people are shouting about.
-- ============================================================================

-- The board did not expose the pick's own id, because until now nothing needed
-- to address a pick. A reaction does.
--
-- Appended rather than put where it belongs, next to the other ids: `create or
-- replace view` may add columns at the end and nothing else, and renaming the
-- first column is what it thinks you are doing otherwise. `pick_id` rather
-- than `id` regardless, because this row already carries a team_id and a
-- player_id and a bare `id` among them says nothing about which.
create or replace view public.draft_board with (security_invoker = true) as
select dp.draft_id,
       dp.pick_number,
       dp.round,
       dp.is_autopick,
       dp.made_at,
       t.id   as team_id,
       t.name as team_name,
       t.draft_slot,
       p.id   as player_id,
       p.full_name as player_name,
       p."position",
       p.nfl_team,
       m.source_id as espn_id,
       dp.id  as pick_id
  from draft_picks dp
  join teams t   on t.id = dp.team_id
  join players p on p.id = dp.player_id
  left join player_id_map m
    on m.player_id = p.id and m.source in ('espn', 'espn_team');


-- One more stream. The constraint is widened rather than dropped: the whole
-- point of it is that `source` is a closed set, so a typo in a client is a
-- rejected write and not a reaction nobody can ever see.
alter table public.reactions drop constraint if exists reactions_source_check;
alter table public.reactions
  add constraint reactions_source_check
  check (source in ('message', 'event', 'poll', 'pick'));


-- ---------------------------------------------------------------------------
-- ff_react, with the pick branch.
--
-- Re-declared whole rather than patched, because the guard and the existence
-- check are one rule in two halves: widening the list of accepted sources
-- without widening the CASE would accept 'pick' and then reject every pick as
-- "no such line in this league", which is how the poll branch broke the first
-- time it was added.
-- ---------------------------------------------------------------------------
create or replace function public.ff_react(
  p_league_id uuid,
  p_source    text,
  p_target_id uuid,
  p_emoji     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_n integer; v_on boolean; v_ok boolean;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if p_source not in ('message','event','poll','pick') then raise exception 'no such feed'; end if;

  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  -- The target must exist, in this league, in the stream it says it is in. A
  -- pick reaches its league through its draft, which is the only table in this
  -- CASE that does not carry league_id itself.
  v_ok := case p_source
    when 'message' then exists (select 1 from league_messages  where id = p_target_id and league_id = p_league_id)
    when 'event'   then exists (select 1 from activity_events where id = p_target_id and league_id = p_league_id)
    when 'poll'    then exists (select 1 from polls           where id = p_target_id and league_id = p_league_id)
    when 'pick'    then exists (select 1 from draft_picks dp
                                  join drafts d on d.id = dp.draft_id
                                 where dp.id = p_target_id and d.league_id = p_league_id)
  end;
  if not v_ok then raise exception 'no such line in this league'; end if;

  delete from reactions
   where source = p_source and target_id = p_target_id
     and user_id = v_uid and emoji = p_emoji;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    insert into reactions (league_id, source, target_id, user_id, emoji)
    values (p_league_id, p_source, p_target_id, v_uid, p_emoji);
    v_on := true;
  else
    v_on := false;
  end if;

  return jsonb_build_object(
    'emoji', p_emoji,
    'mine',  v_on,
    'count', (select count(*) from reactions
               where source = p_source and target_id = p_target_id and emoji = p_emoji));
end $$;

revoke execute on function public.ff_react(uuid, text, uuid, text) from public, anon;
grant execute on function public.ff_react(uuid, text, uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Every reaction on a draft, in one call.
--
-- The board polls, and a draft has up to a hundred and eighty picks. Asking
-- per pick would be a hundred and eighty round trips on a screen where the
-- whole league is watching the same thing at the same time.
-- ---------------------------------------------------------------------------
create or replace function public.ff_draft_reactions(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_league uuid;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  select league_id into v_league from drafts where id = p_draft_id;
  if v_league is null then raise exception 'draft not found'; end if;
  if not public.ff_is_member(v_league) then raise exception 'not a member of this league'; end if;

  select coalesce(jsonb_object_agg(pick_id, tallies), '{}'::jsonb) into v_out
  from (
    select r.target_id::text as pick_id,
           jsonb_agg(jsonb_build_object(
             'emoji', r.emoji,
             'count', r.n,
             'mine',  r.mine
           ) order by r.n desc, r.emoji) as tallies
      from (
        select r.target_id, r.emoji,
               count(*)::int as n,
               bool_or(r.user_id = v_uid) as mine
          from reactions r
          join draft_picks dp on dp.id = r.target_id
         where r.source = 'pick' and dp.draft_id = p_draft_id
         group by r.target_id, r.emoji
      ) r
     group by r.target_id
  ) q;

  return v_out;
end $$;

comment on function public.ff_draft_reactions(uuid) is
  'Every reaction on one draft''s picks, keyed by pick id, so a board of a hundred and eighty picks costs one round trip rather than a hundred and eighty.';

revoke execute on function public.ff_draft_reactions(uuid) from public, anon;
grant execute on function public.ff_draft_reactions(uuid) to authenticated, service_role;
