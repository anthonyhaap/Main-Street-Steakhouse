-- ============================================================================
-- Reactions: the cheapest thing a league can say.
--
-- The House put what the league said and what the league did in one column.
-- This makes both of them answerable without typing, which is the difference
-- between a feed people read and a feed people touch. A trade nobody comments
-- on still gets six flames, and that is the league being a league.
--
-- The one structural wrinkle is that the feed merges two id spaces. A message
-- and an event can perfectly well share a uuid — they come from different
-- tables with independent defaults — so a reaction targets the PAIR
-- (source, target_id), never an id alone. Getting this wrong would show up as
-- reactions leaking between unrelated rows, occasionally, in production, which
-- is about the worst way to find out.
--
-- No foreign key for the same reason: the target lives in one of two tables and
-- Postgres cannot reference "whichever of these two". The integrity that a key
-- would give is enforced in ff_react instead, which is the only way to write
-- here — the table has no insert grant at all.
--
-- Deliberately NOT a notification. Being told somebody put a flame on your
-- trade is how a phone becomes something you silence, and the notifications
-- migration already argued that a system which errs towards sending gets
-- switched off once and never switched back on.
-- ============================================================================

create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  -- Which stream the target came from. Matches ff_house_feed's `source`.
  source     text not null check (source in ('message','event')),
  target_id  uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- A fixed palette rather than free text. Anything a manager can type is
  -- something a manager can type at somebody, and a check constraint is a
  -- cheaper moderation policy than a moderator. It is also what lets the feed
  -- render a stable row of buttons instead of an unbounded set.
  emoji      text not null check (emoji in ('🔥','😂','💀','👀','🫡','🥩')),
  created_at timestamptz not null default now(),
  -- One of each per person per thing: pressing the same button again takes it
  -- back rather than stacking.
  unique (source, target_id, user_id, emoji)
);

create index if not exists reactions_target_idx on public.reactions (source, target_id);
create index if not exists reactions_league_idx on public.reactions (league_id, created_at desc);

comment on table public.reactions is
  'Reactions on House feed items. Keyed by (source, target_id) because the feed merges two id spaces and a message may share a uuid with an event.';

alter table public.reactions enable row level security;

drop policy if exists reactions_read on public.reactions;
create policy reactions_read on public.reactions
  for select to authenticated using (public.ff_is_member());

-- Read only. Every write goes through ff_react, which is what checks that the
-- target actually exists in the league it claims to be in.
revoke all on table public.reactions from public, anon;
grant select on table public.reactions to authenticated;

-- ------------------------------------------------------------- pressing one --

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
declare v_uid uuid := auth.uid(); v_n integer; v_on boolean;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if p_source not in ('message','event') then raise exception 'no such feed'; end if;

  -- Membership of THIS league. ff_is_member() answers "anywhere", which is the
  -- same question only while one league exists — the lesson from ff_house_feed.
  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  -- The target must exist, in this league, in the stream it says it is in.
  -- Without this a manager could react to a row in somebody else's league and
  -- the count would surface there.
  if p_source = 'message' then
    if not exists (select 1 from league_messages where id = p_target_id and league_id = p_league_id) then
      raise exception 'no such line in this league';
    end if;
  else
    if not exists (select 1 from activity_events where id = p_target_id and league_id = p_league_id) then
      raise exception 'no such line in this league';
    end if;
  end if;

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

  return jsonb_build_object('on', v_on, 'emoji', p_emoji,
    'count', (select count(*) from reactions
               where source = p_source and target_id = p_target_id and emoji = p_emoji));
end $$;

-- What the feed hangs under one item: each emoji used, how many, and whether
-- you are one of them. Aggregated here so the feed stays one round trip.
create or replace function public.ff_reactions_for(p_source text, p_target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'emoji', x.emoji, 'count', x.n, 'mine', x.mine) order by x.n desc, x.emoji), '[]'::jsonb)
    from (
      select r.emoji, count(*) as n,
             bool_or(r.user_id = auth.uid()) as mine
        from reactions r
       where r.source = p_source and r.target_id = p_target
       group by r.emoji
    ) x
$$;

revoke execute on function public.ff_react(uuid,text,uuid,text)  from public, anon;
revoke execute on function public.ff_reactions_for(text,uuid)    from public, anon;
grant execute on function public.ff_react(uuid,text,uuid,text)   to authenticated, service_role;
grant execute on function public.ff_reactions_for(text,uuid)     to authenticated, service_role;

-- --------------------------------------------------------- the feed, again --
-- Re-declared only to hang 'reactions' under each item. Everything else is
-- byte-for-byte 20260906014216; the diff is one key.
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
  v_uid   uuid := auth.uid();
  v_team  uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_rows  jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  select id into v_team from teams
   where league_id = p_league_id and owner_id = v_uid limit 1;

  with said as (
    select lm.id,
           lm.created_at as at,
           'message'::text as source,
           lm.kind,
           lm.body,
           null::text as detail,
           case when lm.kind = 'house' then 'The House'
                else coalesce(t.manager_name, t.name, 'League manager') end as author,
           t.id as author_team_id,
           coalesce(lm.author_id = v_uid, false) as mine,
           lm.matchup_id,
           null::text as source_type,
           null::uuid as source_id
      from league_messages lm
      left join teams t on t.owner_id = lm.author_id and t.league_id = p_league_id
     where lm.league_id = p_league_id
       and (p_before is null or lm.created_at < p_before)
  ),
  did as (
    select ae.id,
           ae.created_at as at,
           'event'::text as source,
           ae.event_type as kind,
           ae.headline as body,
           ae.detail,
           t.name as author,
           t.id as author_team_id,
           coalesce(ae.actor_id = v_uid, false) as mine,
           null::uuid as matchup_id,
           ae.source_type,
           ae.source_id
      from activity_events ae
      left join teams t on t.owner_id = ae.actor_id and t.league_id = p_league_id
     where ae.league_id = p_league_id
       and (p_before is null or ae.created_at < p_before)
  ),
  merged as (
    select * from said
    union all
    select * from did
    order by at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'at', m.at, 'source', m.source, 'kind', m.kind,
           'body', m.body, 'detail', m.detail,
           'author', m.author, 'author_team_id', m.author_team_id, 'mine', m.mine,
           'source_type', m.source_type, 'source_id', m.source_id,
           'reactions', ff_reactions_for(m.source, m.id),
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

  return jsonb_build_object(
    'items', v_rows,
    'next_before', case when jsonb_array_length(v_rows) < v_limit then null
                        else (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'at') end,
    'now', now());
end $fn$;

-- ------------------------------------------------------ reactions, live --
-- A reaction that takes thirty seconds to appear is a reaction nobody presses
-- twice. Same reasoning as activity_events in 20260906014216.
do $$ begin alter publication supabase_realtime add table public.reactions;
  exception when duplicate_object then null; end $$;
