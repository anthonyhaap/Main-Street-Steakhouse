-- ============================================================================
-- Splitting the House: a League Feed to read, a Chat to talk in.
--
-- ff_house_feed's whole point was that a trade and the argument about it sat
-- next to each other. That argument won the day this app shipped, but it
-- also meant every screen was both at once — a manager who wanted "what did
-- the league just do" got it wrapped around whatever anyone happened to be
-- typing, and a manager mid-conversation got trades and waiver runs breaking
-- up the thread. Two destinations instead of one:
--
--   ff_league_feed  activity_events, house recaps and commissioner
--                   announcements — read-mostly, the record of what happened.
--   ff_chat_feed    manager messages (with replies and @mentions, added by
--                   20260919030000) and polls — the room people talk in.
--
-- A poll is asked, not recorded, so it stays with Chat rather than moving to
-- the Feed. An announcement is news, not conversation, so it moves the other
-- way even though a commissioner "said" it. `ff_house_feed` is dropped
-- outright rather than kept as a compatibility shim: nothing calls it once
-- /chat and /league-feed stop pointing at it, and a function nobody calls is
-- a function nobody is checking still behaves.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

create or replace function public.ff_chat_feed(
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
           coalesce(t.manager_name, t.name, 'League manager') as author,
           t.id as author_team_id,
           coalesce(lm.author_id = v_uid, false) as mine,
           lm.matchup_id, null::text as source_type, null::uuid as source_id,
           case when lm.parent_id is null then null else (
             select jsonb_build_object(
                      'id', p.id, 'body', left(p.body, 140),
                      'author', coalesce(pt.manager_name, pt.name, 'League manager'))
               from league_messages p
               left join teams pt on pt.id = public.ff_seat_team(p_league_id, p.author_id)
              where p.id = lm.parent_id) end as parent,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'user_id', mm.user_id,
                      'author', coalesce(mt.manager_name, mt.name, 'League manager')))
               from message_mentions mm
               left join teams mt on mt.id = public.ff_seat_team(p_league_id, mm.user_id)
              where mm.message_id = lm.id
           ), '[]'::jsonb) as mentions
      from league_messages lm
      left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
     where lm.league_id = p_league_id and lm.kind = 'manager'
       and (p_before is null or lm.created_at < p_before)
  ),
  asked as (
    select pl.id, pl.created_at as at, 'poll'::text as source, 'poll'::text as kind,
           pl.question as body, null::text as detail,
           coalesce(t.manager_name, t.name, 'League manager') as author,
           t.id as author_team_id,
           coalesce(pl.author_id = v_uid, false) as mine,
           null::uuid as matchup_id, null::text as source_type, null::uuid as source_id,
           null::jsonb as parent, '[]'::jsonb as mentions
      from polls pl
      left join teams t on t.id = public.ff_seat_team(p_league_id, pl.author_id)
     where pl.league_id = p_league_id
       and (p_before is null or pl.created_at < p_before)
  ),
  merged as (
    select * from said
    union all select * from asked
    order by at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'at', m.at, 'source', m.source, 'kind', m.kind,
           'body', m.body, 'detail', m.detail,
           'author', m.author, 'author_team_id', m.author_team_id, 'mine', m.mine,
           'source_type', m.source_type, 'source_id', m.source_id,
           'parent', m.parent, 'mentions', m.mentions,
           'reactions', ff_reactions_for(m.source, m.id),
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

  return jsonb_build_object(
    'items', v_rows,
    'next_before', case when jsonb_array_length(v_rows) < v_limit then null
                        else (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'at') end,
    'now', now());
end $fn$;

comment on function public.ff_chat_feed(uuid, timestamptz, integer) is
  'The room: manager messages (with replies and @mentions) and polls, newest first, paginated by p_before.';

create or replace function public.ff_league_feed(
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
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_rows   jsonb;
  v_pinned jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  with did as (
    select ae.id, ae.created_at as at, 'event'::text as source, ae.event_type as kind,
           ae.headline as body, ae.detail,
           t.name as author, t.id as author_team_id,
           coalesce(ae.actor_id = v_uid, false) as mine,
           ae.source_type, ae.source_id,
           false as pinned
      from activity_events ae
      left join teams t on t.id = public.ff_seat_team(p_league_id, ae.actor_id)
     where ae.league_id = p_league_id
       and (p_before is null or ae.created_at < p_before)
  ),
  said as (
    select lm.id, lm.created_at as at, 'message'::text as source, lm.kind,
           lm.body, null::text as detail,
           case when lm.kind = 'house' then 'The House'
                else coalesce(t.manager_name, t.name, 'The Commissioner') end as author,
           t.id as author_team_id,
           coalesce(lm.author_id = v_uid, false) as mine,
           null::text as source_type, null::uuid as source_id,
           lm.pinned
      from league_messages lm
      left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
     where lm.league_id = p_league_id and lm.kind in ('house', 'announcement')
       and (p_before is null or lm.created_at < p_before)
  ),
  merged as (
    select id, at, source, kind, body, detail, author, author_team_id, mine, source_type, source_id, pinned from did
    union all
    select id, at, source, kind, body, detail, author, author_team_id, mine, source_type, source_id, pinned from said
    order by at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'at', m.at, 'source', m.source, 'kind', m.kind,
           'body', m.body, 'detail', m.detail,
           'author', m.author, 'author_team_id', m.author_team_id, 'mine', m.mine,
           'source_type', m.source_type, 'source_id', m.source_id, 'pinned', m.pinned,
           'reactions', ff_reactions_for(m.source, m.id)
         ) order by m.at desc), '[]'::jsonb)
    into v_rows from merged m;

  -- The pinned rail: every currently-pinned announcement, independent of
  -- `p_before`, exactly as ff_house_feed served it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', lm.id, 'at', lm.created_at, 'source', 'message', 'kind', lm.kind,
           'body', lm.body, 'detail', null,
           'author', coalesce(t.manager_name, t.name, 'The Commissioner'),
           'author_team_id', t.id, 'mine', coalesce(lm.author_id = v_uid, false),
           'source_type', null, 'source_id', null, 'pinned', true,
           'reactions', ff_reactions_for('message', lm.id)
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

comment on function public.ff_league_feed(uuid, timestamptz, integer) is
  'The record: activity events, house recaps and commissioner announcements, newest first, paginated by p_before, plus a pinned array of every announcement currently held to the rail.';

-- ff_house_feed is retired: /chat and /league-feed call the two functions
-- above instead, and nothing else in the schema references it. Kept until
-- this migration to make the diff a straight split rather than a rewrite.
drop function if exists public.ff_house_feed(uuid, timestamptz, integer);

-- ------------------------------------------------------------- the grants --

revoke execute on function public.ff_chat_feed(uuid, timestamptz, integer)   from public, anon;
revoke execute on function public.ff_league_feed(uuid, timestamptz, integer) from public, anon;

grant execute on function public.ff_chat_feed(uuid, timestamptz, integer)   to authenticated, service_role;
grant execute on function public.ff_league_feed(uuid, timestamptz, integer) to authenticated, service_role;
