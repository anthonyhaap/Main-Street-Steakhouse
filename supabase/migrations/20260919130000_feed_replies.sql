-- ============================================================================
-- Replies: an argument that stays with the thing it is about.
--
-- Reactions made a feed item answerable without typing; a reaction is a flame,
-- not a sentence. Once somebody has an actual argument to make — "that's not
-- what happened" under a trade, "which week" under a poll — it either becomes
-- a new top-level line in the House, unmoored from what it is about the moment
-- three more things get posted, or it never gets typed at all. Neither is
-- right for a league that already argues about everything.
--
-- Same wrinkle as reactions: the feed merges three id spaces (message, event,
-- poll), so a reply targets the PAIR (source, target_id), never an id alone,
-- and there is no foreign key for the same reason ff_react has none — the
-- integrity lives in ff_reply instead, which is the only way to write here.
--
-- ff_house_feed gains a `reply_count` on every item so the row can say "3
-- replies" without a second round trip; the replies themselves are fetched on
-- demand by ff_feed_replies when a manager actually opens the thread; a busy
-- House with forty items and a dozen threads has no reason to ship all of them
-- on every page load.
-- ============================================================================

-- ------------------------------------------------------------- the schema --

create table if not exists public.feed_replies (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  -- Matches ff_house_feed's `source`, same three streams a reaction can land on.
  source     text not null check (source in ('message','event','poll')),
  target_id  uuid not null,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists feed_replies_target_idx on public.feed_replies (source, target_id, created_at);
create index if not exists feed_replies_league_idx on public.feed_replies (league_id, created_at desc);

comment on table public.feed_replies is
  'Threaded replies on a House feed item. Keyed by (source, target_id) because the feed merges three id spaces and a message may share a uuid with an event or a poll.';

alter table public.feed_replies enable row level security;

drop policy if exists feed_replies_read on public.feed_replies;
create policy feed_replies_read on public.feed_replies
  for select to authenticated using (public.ff_is_member(league_id));

-- Read only. Every write goes through ff_reply, which is what checks the
-- target actually exists in the league it claims to be in.
revoke all on table public.feed_replies from public, anon, authenticated;
grant select on table public.feed_replies to authenticated;

-- ------------------------------------------------------------- replying --

create or replace function public.ff_reply(
  p_league_id uuid,
  p_source    text,
  p_target_id uuid,
  p_body      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_body text := btrim(p_body); v_ok boolean;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if p_source not in ('message','event','poll') then raise exception 'no such feed'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'a reply must be 1 to 500 characters';
  end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  -- The target must exist, in this league, in the stream it says it is in —
  -- same guard ff_react makes, for the same reason.
  v_ok := case p_source
    when 'message' then exists (select 1 from league_messages where id = p_target_id and league_id = p_league_id)
    when 'event'   then exists (select 1 from activity_events where id = p_target_id and league_id = p_league_id)
    when 'poll'    then exists (select 1 from polls           where id = p_target_id and league_id = p_league_id)
  end;
  if not v_ok then raise exception 'no such line in this league'; end if;

  insert into feed_replies (league_id, source, target_id, author_id, body)
  values (p_league_id, p_source, p_target_id, v_uid, v_body);

  return public.ff_feed_replies(p_source, p_target_id);
end $$;

-- ------------------------------------------------------------ reading a thread --

-- SECURITY DEFINER, so it bypasses feed_replies_read and has to spell out its
-- own membership check rather than lean on the policy that guards a direct
-- table read — the gap a caller who only knows a target_id would otherwise
-- walk straight through.
create or replace function public.ff_feed_replies(p_source text, p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_league uuid;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if p_source not in ('message','event','poll') then raise exception 'no such feed'; end if;

  v_league := case p_source
    when 'message' then (select league_id from league_messages where id = p_target_id)
    when 'event'   then (select league_id from activity_events where id = p_target_id)
    when 'poll'    then (select league_id from polls           where id = p_target_id)
  end;
  if v_league is null then raise exception 'no such line'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(v_league, v_uid))
     and (select commissioner_id from leagues where id = v_league) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', fr.id, 'at', fr.created_at, 'body', fr.body,
             'author', coalesce(t.manager_name, t.name, 'League manager'),
             'author_team_id', t.id,
             'mine', coalesce(fr.author_id = v_uid, false)
           ) order by fr.created_at)
      from feed_replies fr
      left join teams t on t.id = public.ff_seat_team(fr.league_id, fr.author_id)
     where fr.source = p_source and fr.target_id = p_target_id
  ), '[]'::jsonb);
end $$;

revoke execute on function public.ff_reply(uuid,text,uuid,text) from public, anon;
revoke execute on function public.ff_feed_replies(text,uuid)    from public, anon;
grant execute on function public.ff_reply(uuid,text,uuid,text)  to authenticated, service_role;
grant execute on function public.ff_feed_replies(text,uuid)     to authenticated, service_role;

-- --------------------------------------------------------------- the feed --
-- Re-declared to hang a `reply_count` under every item, ordinary and pinned.
-- Everything else is byte-for-byte 20260918120000; the diff is one key in each
-- jsonb_build_object.

create or replace function public.ff_house_feed(
  p_league_id uuid,
  p_before    timestamptz default null,
  p_limit     integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_team   uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_rows   jsonb;
  v_pinned jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_team := public.ff_seat_team(p_league_id, v_uid);

  with said as (
    select lm.id, lm.created_at as at, 'message'::text as source, lm.kind,
           lm.body, null::text as detail,
           case when lm.kind = 'house' then 'The House'
                when lm.kind = 'announcement' then coalesce(t.manager_name, t.name, 'The Commissioner')
                else coalesce(t.manager_name, t.name, 'League manager') end as author,
           t.id as author_team_id,
           coalesce(lm.author_id = v_uid, false) as mine,
           lm.matchup_id, null::text as source_type, null::uuid as source_id,
           lm.pinned
      from league_messages lm
      left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
     where lm.league_id = p_league_id
       and (p_before is null or lm.created_at < p_before)
  ),
  did as (
    select ae.id, ae.created_at as at, 'event'::text as source, ae.event_type as kind,
           ae.headline as body, ae.detail,
           t.name as author, t.id as author_team_id,
           coalesce(ae.actor_id = v_uid, false) as mine,
           null::uuid as matchup_id, ae.source_type, ae.source_id,
           false as pinned
      from activity_events ae
      left join teams t on t.id = public.ff_seat_team(p_league_id, ae.actor_id)
     where ae.league_id = p_league_id
       and (p_before is null or ae.created_at < p_before)
  ),
  asked as (
    select pl.id, pl.created_at as at, 'poll'::text as source, 'poll'::text as kind,
           pl.question as body, null::text as detail,
           coalesce(t.manager_name, t.name, 'League manager') as author,
           t.id as author_team_id,
           coalesce(pl.author_id = v_uid, false) as mine,
           null::uuid as matchup_id, null::text as source_type, null::uuid as source_id,
           false as pinned
      from polls pl
      left join teams t on t.id = public.ff_seat_team(p_league_id, pl.author_id)
     where pl.league_id = p_league_id
       and (p_before is null or pl.created_at < p_before)
  ),
  merged as (
    select * from said
    union all select * from did
    union all select * from asked
    order by at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'at', m.at, 'source', m.source, 'kind', m.kind,
           'body', m.body, 'detail', m.detail,
           'author', m.author, 'author_team_id', m.author_team_id, 'mine', m.mine,
           'source_type', m.source_type, 'source_id', m.source_id,
           'pinned', m.pinned,
           'reactions', ff_reactions_for(m.source, m.id),
           'reply_count', (select count(*) from feed_replies fr
                             where fr.source = m.source and fr.target_id = m.id),
           'poll', case when m.source = 'poll' then ff_poll_for(m.id) else null end,
           'matchup', case when m.matchup_id is null then null else (
             select jsonb_build_object(
                      'id', mu.id, 'week', mu.week,
                      'home', th.name, 'away', ta.name,
                      'mine', v_team is not null and v_team in (mu.home_team_id, mu.away_team_id))
               from matchups mu
               join teams th on th.id = mu.home_team_id
               join teams ta on ta.id = mu.away_team_id
              where mu.id = m.matchup_id) end
         ) order by m.at desc), '[]'::jsonb)
    into v_rows from merged m;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', lm.id, 'at', lm.created_at, 'source', 'message', 'kind', lm.kind,
           'body', lm.body, 'detail', null,
           'author', coalesce(t.manager_name, t.name, 'The Commissioner'),
           'author_team_id', t.id, 'mine', coalesce(lm.author_id = v_uid, false),
           'source_type', null, 'source_id', null, 'matchup', null, 'pinned', true,
           'reactions', ff_reactions_for('message', lm.id),
           'reply_count', (select count(*) from feed_replies fr
                             where fr.source = 'message' and fr.target_id = lm.id),
           'poll', null
         ) order by lm.created_at desc), '[]'::jsonb)
    into v_pinned
    from league_messages lm
    left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
   where lm.league_id = p_league_id and lm.pinned;

  return jsonb_build_object(
    'items', v_rows,
    'pinned', v_pinned,
    'next_before', case when jsonb_array_length(v_rows) < v_limit then null
                        else (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'at') end,
    'now', now());
end $fn$;

comment on function public.ff_house_feed(uuid, timestamptz, integer) is
  'The league in one stream: what managers said and what the league did, newest first, paginated by `p_before`, plus a `pinned` array of every announcement currently held to the top and a `reply_count` on every item.';

revoke execute on function public.ff_house_feed(uuid, timestamptz, integer) from public, anon;
grant execute on function public.ff_house_feed(uuid, timestamptz, integer)  to authenticated, service_role;

-- ------------------------------------------------------------ replies, live --
do $$ begin alter publication supabase_realtime add table public.feed_replies;
  exception when duplicate_object then null; end $$;
