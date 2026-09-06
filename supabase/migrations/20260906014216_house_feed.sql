-- ============================================================================
-- The House feed: one room, everything in it.
--
-- The league already produced two streams and showed them in different places.
-- `league_messages` is what managers say, and /chat rendered it. `activity_events`
-- is what the league DOES — a signing, a settled waiver, an accepted trade, a
-- posted recap — and nothing rendered it at all; it was written by four
-- migrations and read by a front-page summary that shows four items.
--
-- Splitting them was the mistake. A trade going through is the most talked-about
-- thing that happens in a fantasy league, and it was happening somewhere nobody
-- was looking, while the room where everyone talks had no idea it had occurred.
-- The argument and the thing being argued about belong on the same page.
--
-- So this is one merged, paginated stream, and /chat becomes the House rather
-- than a second destination competing with it. That last part is deliberate:
-- the comment at the top of the old chat page already argued that a league of
-- twelve cannot afford a conversation only two people ever see, and a separate
-- feed screen would have split the room in exactly the way it warned about.
--
-- Cursor rather than offset. A feed that anybody is posting to shifts under an
-- offset, so page two silently repeats or skips a line; `p_before` on the
-- timestamp cannot.
-- ============================================================================

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

  -- Membership of THIS league, not membership in general. ff_is_member() asks
  -- whether you own a team anywhere or commission anything anywhere, which is
  -- the same question only while there is one league — and this function takes
  -- a league id, so it must answer the question it was actually asked. Same
  -- check ff_clubhouse_feed makes, for the same reason.
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
           -- The House speaks as itself; everyone else speaks as their club.
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
           -- An event caused by a manager is attributed to his club; one the
           -- league did to itself (a settlement, a recap) has no author, and
           -- saying "The House" there would be a small lie about who acted.
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
    -- The cursor for the next page, and the fact that there is one. Computed
    -- from what was actually returned rather than a count, so it stays right
    -- while somebody is posting.
    'next_before', case when jsonb_array_length(v_rows) < v_limit then null
                        else (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'at') end,
    'now', now());
end $fn$;

comment on function public.ff_house_feed(uuid, timestamptz, integer) is
  'The league in one stream: what managers said and what the league did, newest first, paginated by `p_before` rather than an offset.';

revoke execute on function public.ff_house_feed(uuid, timestamptz, integer) from public, anon;
grant execute on function public.ff_house_feed(uuid, timestamptz, integer) to authenticated, service_role;

-- ------------------------------------------------------- the House, live --
-- league_messages was already published; activity_events was not, so the
-- feed's subscription to it would have been a thirty-second poll wearing a
-- subscription's clothes — the same thing that was true of every waivers and
-- trades table until 20260905125401. A signing that takes half a minute to
-- appear in the room is the one kind of lag this screen cannot afford, because
-- the argument about it arrives instantly.
do $$ begin alter publication supabase_realtime add table public.activity_events;
  exception when duplicate_object then null; end $$;
