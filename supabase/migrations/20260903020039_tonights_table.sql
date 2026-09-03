-- ============================================================================
-- Tonight's Table: the briefing, the history wall, and the share card.
--
-- The home screen stops being a dashboard and becomes a reservation card. To
-- write "You've dropped three straight to Dave" it needs the league's whole
-- head-to-head record in one place, and to write "you need 14.3 from Kelce" it
-- needs to know which of your starters still has a game to play. Four things:
--
--   1. `league_history` — every matchup the league has played in past seasons,
--      keyed by the *manager* rather than a team row, because teams are
--      re-created each season and people are not. The current season joins in
--      through `teams.manager_name`, so the wall is live from week two of 2026
--      whether or not the old ESPN seasons have been imported yet. The
--      commissioner imports those with `ff_import_history`, once.
--
--   2. `ff_briefing(league_id)` — one call for everything the first screen
--      says: my matchup, both projected totals, live totals, who still has a
--      game left and what he is projected for, my record and seed, the
--      all-time and current-season head-to-head against tonight's opponent,
--      last week's result, the week's other games for the carousel, and the
--      NFL calendar the day-of-week personality is decided from. Every number
--      is priced with this league's rules, as everywhere else.
--
--   3. `ff_history(league_id)` — the room with "Est. 2016" on the door: the
--      champions, a head-to-head grid, streaks, blowouts, and a card per
--      manager with a title earned from the record.
--
--   4. `ff_share_card(matchup_id)` — the one thing here anon may call. A card
--      posted into the group chat unfurls without a session, so it reads two
--      team names, two managers, two scores and a week from a matchup whose
--      id is a UUID nobody can guess. Nothing else leaves the league.
-- ============================================================================

-- ---------------------------------------------------------------- history --

create table if not exists public.league_history (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues(id) on delete cascade,
  season        integer not null,
  week          integer not null,
  round         text not null default 'regular',
  home_manager  text not null,
  away_manager  text not null,
  home_team     text,
  away_team     text,
  home_points   numeric(8,2) not null default 0,
  away_points   numeric(8,2) not null default 0,
  created_at    timestamptz not null default now(),
  constraint league_history_round_check
    check (round in ('regular','quarterfinal','semifinal','final','third','consolation')),
  constraint league_history_once unique (league_id, season, week, home_manager, away_manager)
);

create index if not exists league_history_season_idx on public.league_history (league_id, season, week);

comment on table public.league_history is
  'Every matchup the league played in past seasons, keyed by manager name. The current season is not stored here; ff_history and ff_briefing union it in from matchups through teams.manager_name.';

alter table public.league_history enable row level security;

drop policy if exists league_history_members_read on public.league_history;
create policy league_history_members_read on public.league_history
  for select to authenticated using (public.ff_is_member());

-- The commissioner replaces a season wholesale. Rows arrive as a JSON array of
-- {season, week, round, home_manager, away_manager, home_team, away_team,
-- home_points, away_points}; every season mentioned is deleted first, so a
-- corrected export can be pasted again without duplicates.
create or replace function public.ff_import_history(p_league_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seasons integer[];
  v_n       integer;
begin
  perform ff_assert_commissioner(p_league_id);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;

  select array_agg(distinct (r->>'season')::int) into v_seasons
    from jsonb_array_elements(p_rows) r;

  delete from league_history where league_id = p_league_id and season = any(v_seasons);

  insert into league_history
    (league_id, season, week, round, home_manager, away_manager, home_team, away_team, home_points, away_points)
  select p_league_id,
         (r->>'season')::int,
         (r->>'week')::int,
         coalesce(nullif(lower(trim(r->>'round')), ''), 'regular'),
         trim(r->>'home_manager'),
         trim(r->>'away_manager'),
         nullif(trim(r->>'home_team'), ''),
         nullif(trim(r->>'away_team'), ''),
         coalesce((r->>'home_points')::numeric, 0),
         coalesce((r->>'away_points')::numeric, 0)
    from jsonb_array_elements(p_rows) r
   where nullif(trim(r->>'home_manager'), '') is not null
     and nullif(trim(r->>'away_manager'), '') is not null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('seasons', to_jsonb(v_seasons), 'rows', v_n);
end $$;

revoke all on function public.ff_import_history(uuid, jsonb) from public, anon;
grant execute on function public.ff_import_history(uuid, jsonb) to authenticated;

comment on function public.ff_import_history(uuid, jsonb) is
  'Commissioner only. Replaces every season present in p_rows with the rows given. Manager names are the key across seasons; spell them the way teams.manager_name does so the current season lines up.';

-- Every game the league has on record, past seasons and this one, in one shape.
-- A playoff round is stored under its NFL week; `round` says what it was for.
create or replace function public.ff_all_games(p_league_id uuid)
returns table (
  season integer, week integer, round text,
  home_manager text, away_manager text, home_team text, away_team text,
  home_points numeric, away_points numeric, played boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select h.season, h.week, h.round,
         h.home_manager, h.away_manager, h.home_team, h.away_team,
         h.home_points, h.away_points, true
    from league_history h
   where h.league_id = p_league_id
  union all
  select l.season, m.week,
         case when m.week > coalesce((l.settings->>'regular_season_weeks')::int, 14)
              then 'playoff' else 'regular' end,
         coalesce(th.manager_name, th.name), coalesce(ta.manager_name, ta.name),
         th.name, ta.name,
         m.home_points, m.away_points,
         (m.home_points + m.away_points > 0)
    from matchups m
    join leagues l  on l.id = m.league_id
    join teams th   on th.id = m.home_team_id
    join teams ta   on ta.id = m.away_team_id
   where m.league_id = p_league_id
$$;

revoke all on function public.ff_all_games(uuid) from public, anon;
grant execute on function public.ff_all_games(uuid) to authenticated;

-- The same games, once from each manager's side. Played games only.
create or replace function public.ff_all_sides(p_league_id uuid)
returns table (
  season integer, week integer, round text,
  manager text, opponent text, team text, pf numeric, pa numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select g.season, g.week, g.round, g.home_manager, g.away_manager, g.home_team, g.home_points, g.away_points
    from public.ff_all_games(p_league_id) g where g.played
  union all
  select g.season, g.week, g.round, g.away_manager, g.home_manager, g.away_team, g.away_points, g.home_points
    from public.ff_all_games(p_league_id) g where g.played
$$;

revoke all on function public.ff_all_sides(uuid) from public, anon;
grant execute on function public.ff_all_sides(uuid) to authenticated;

-- A run of results, most recent first, in: how long the current run is.
-- ['W','W','L'] → {kind: 'W', n: 2}.
create or replace function public.ff_streak(p_kinds text[])
returns jsonb
language sql
immutable
as $$
  select case
    when p_kinds is null or cardinality(p_kinds) = 0 then jsonb_build_object('kind', null, 'n', 0)
    else jsonb_build_object(
      'kind', p_kinds[1],
      'n', (select count(*) from unnest(p_kinds) with ordinality as u(k, o)
             where u.o < coalesce((select min(v.o) from unnest(p_kinds) with ordinality as v(k, o)
                                    where v.k <> p_kinds[1]), cardinality(p_kinds) + 1)))
  end
$$;

-- --------------------------------------------------------------- briefing --

create or replace function public.ff_briefing(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_league    leagues%rowtype;
  v_team      teams%rowtype;
  v_opp       teams%rowtype;
  v_mu        matchups%rowtype;
  v_week      integer;
  v_rules     jsonb;
  v_reg       integer;
  v_me        jsonb;
  v_draft     jsonb;
  v_matchup   jsonb;
  v_last      jsonb;
  v_games     jsonb;
  v_history   jsonb;
  v_standings jsonb;
  v_board     jsonb;
  v_lineup    jsonb;
  v_my_name   text;
  v_opp_name  text;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if v_uid is not null
     and not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week  := greatest(1, public.ff_current_week());
  v_rules := public.ff_rules_for_week(p_league_id, v_week);
  v_reg   := coalesce((v_league.settings->>'regular_season_weeks')::int, 14);

  select * into v_team from teams where league_id = p_league_id and owner_id = v_uid limit 1;

  -- ------------------------------------------------------------ standings --
  -- Seeded the way the standings page sorts: wins (a tie is half), then points.
  select coalesce(jsonb_agg(x order by (x->>'seed')::int), '[]'::jsonb) into v_standings
  from (
    select jsonb_build_object(
      'team_id', s.team_id, 'name', s.name, 'manager_name', s.manager_name,
      'logo_path', t.logo_path,
      'wins', s.wins, 'losses', s.losses, 'ties', s.ties,
      'points_for', s.points_for, 'points_against', s.points_against,
      'seed', row_number() over (order by s.wins + s.ties / 2.0 desc, s.points_for desc, s.name)
    ) as x
    from standings s join teams t on t.id = s.team_id
    where s.league_id = p_league_id
  ) q;

  -- ------------------------------------------------------------------- me --
  if v_team.id is not null then
    select jsonb_build_object(
      'team_id', v_team.id, 'name', v_team.name, 'manager_name', v_team.manager_name,
      'logo_path', v_team.logo_path, 'draft_slot', v_team.draft_slot,
      'wins', st.wins, 'losses', st.losses, 'ties', st.ties,
      'points_for', st.points_for, 'points_against', st.points_against,
      'seed', (select (x->>'seed')::int from jsonb_array_elements(v_standings) x
                where x->>'team_id' = v_team.id::text),
      'streak', public.ff_streak((
        select array_agg(case when pf > pa then 'W' when pf < pa then 'L' else 'T' end order by week desc)
          from (select m.week,
                       case when m.home_team_id = v_team.id then m.home_points else m.away_points end as pf,
                       case when m.home_team_id = v_team.id then m.away_points else m.home_points end as pa
                  from matchups m
                 where m.league_id = p_league_id and v_team.id in (m.home_team_id, m.away_team_id)
                   and m.home_points + m.away_points > 0) r))
    ) into v_me
    from standings st where st.team_id = v_team.id;
  end if;

  -- ---------------------------------------------------------------- draft --
  select jsonb_build_object(
    'id', d.id, 'status', d.status, 'current_pick', d.current_pick,
    'pick_deadline', d.pick_deadline, 'picks_total', d.rounds * v_league.team_count,
    'on_clock_team_id', case when d.status = 'active' then public.ff_team_on_clock(d.id) end,
    'started_at', d.started_at, 'completed_at', d.completed_at
  ) into v_draft
  from drafts d where d.league_id = p_league_id order by d.started_at desc nulls last limit 1;

  -- ------------------------------------------------------------- calendar --
  -- The state of this week's NFL slate: what has kicked, what is in progress,
  -- when the next game is. The browser turns this into Tuesday/Sunday/Monday.
  select jsonb_build_object(
    'week', v_week,
    'first_kick', min(g.kickoff_at),
    'last_kick',  max(g.kickoff_at),
    'total',      count(*),
    'final',      count(*) filter (where g.status = 'post'),
    'in_progress', count(*) filter (where g.status = 'in'),
    'next_kickoff', min(g.kickoff_at) filter (where g.kickoff_at > now()),
    'last_final_at', max(g.updated_at) filter (where g.status = 'post')
  ) into v_games
  from nfl_games g
  where g.season = v_league.season and g.season_type = 2 and g.week = v_week;

  -- -------------------------------------------------------------- matchup --
  if v_team.id is not null then
    select * into v_mu from matchups m
     where m.league_id = p_league_id and m.week = v_week
       and v_team.id in (m.home_team_id, m.away_team_id);
  end if;

  if v_mu.id is not null then
    select * into v_opp from teams
     where id = case when v_mu.home_team_id = v_team.id then v_mu.away_team_id else v_mu.home_team_id end;

    -- Every starter on both sides, with this week's points, projection and the
    -- state of his real game. A starter whose game is not final still counts
    -- his projection: that is what the Monday-night line is written from.
    with side as (
      select r.team_id, r.player_id, r.slot,
             p.full_name, p.position, p.nfl_team, p.bye_week,
             (select max(x.source_id) from player_id_map x
               where x.player_id = r.player_id and x.source in ('espn','espn_team')) as espn_id,
             coalesce((select round(public.ff_score(sl.stats, v_rules), 2)
                         from player_stat_lines sl
                        where sl.player_id = r.player_id and sl.season = v_league.season
                          and sl.season_type = 2 and sl.week = v_week and sl.source = 'sleeper'), 0) as points,
             (select round(public.ff_score(pj.stats, v_rules), 2)
                from player_projections pj
               where pj.player_id = r.player_id and pj.season = v_league.season
                 and pj.season_type = 2 and pj.week = v_week and pj.source = 'sleeper') as projection,
             g.kickoff_at, g.status as game_status,
             case when g.home_team = p.nfl_team then g.away_team else g.home_team end as opponent
        from rosters r
        join players p on p.id = r.player_id
        left join nfl_games g
          on g.season = v_league.season and g.season_type = 2 and g.week = v_week
         and p.nfl_team in (g.home_team, g.away_team)
       where r.week = v_week and r.slot <> 'BN'
         and r.team_id in (v_mu.home_team_id, v_mu.away_team_id)
    ),
    rows_ as (
      select s.team_id,
             jsonb_agg(jsonb_build_object(
               'player_id', s.player_id, 'full_name', s.full_name, 'position', s.position,
               'nfl_team', s.nfl_team, 'slot', s.slot, 'espn_id', s.espn_id,
               'points', s.points, 'projection', s.projection,
               'kickoff_at', s.kickoff_at, 'game_status', s.game_status, 'opponent', s.opponent,
               'on_bye', coalesce(s.bye_week = v_week, false),
               -- Final once the game is over; also final if he has no game at all.
               'final', coalesce(s.game_status = 'post', s.kickoff_at is null)
             ) order by array_position(array['QB','RB','WR','TE','FLEX','K','DST'], s.slot), s.full_name) as starters,
             count(*) as n,
             round(coalesce(sum(s.projection), 0), 2) as proj,
             -- Projection still to come: starters whose game has not kicked.
             round(coalesce(sum(s.projection) filter (where s.game_status is null or s.game_status = 'pre'), 0), 2) as proj_left,
             round(coalesce(sum(s.points), 0), 2) as pts
        from side s group by s.team_id
    ),
    slots as (
      select count(*) as n from jsonb_array_elements_text(v_league.roster_slots) x where x <> 'BN'
    )
    select jsonb_build_object(
      'id', v_mu.id, 'week', v_week,
      'home', (v_mu.home_team_id = v_team.id),
      'my_points',  round(case when v_mu.home_team_id = v_team.id then v_mu.home_points else v_mu.away_points end, 2),
      'opp_points', round(case when v_mu.home_team_id = v_team.id then v_mu.away_points else v_mu.home_points end, 2),
      'my_proj',  coalesce((select proj from rows_ where team_id = v_team.id), 0),
      'opp_proj', coalesce((select proj from rows_ where team_id = v_opp.id), 0),
      'my_proj_left',  coalesce((select proj_left from rows_ where team_id = v_team.id), 0),
      'opp_proj_left', coalesce((select proj_left from rows_ where team_id = v_opp.id), 0),
      'my_starters',  coalesce((select starters from rows_ where team_id = v_team.id), '[]'::jsonb),
      'opp_starters', coalesce((select starters from rows_ where team_id = v_opp.id), '[]'::jsonb),
      'my_empty_slots', greatest(0, (select n from slots) - coalesce((select n from rows_ where team_id = v_team.id), 0)),
      'opponent', jsonb_build_object(
        'team_id', v_opp.id, 'name', v_opp.name, 'manager_name', v_opp.manager_name,
        'logo_path', v_opp.logo_path,
        'wins', st.wins, 'losses', st.losses, 'ties', st.ties,
        'seed', (select (x->>'seed')::int from jsonb_array_elements(v_standings) x
                  where x->>'team_id' = v_opp.id::text)
      )
    ) into v_matchup
    from standings st where st.team_id = v_opp.id;
  end if;

  -- ----------------------------------------------------------- last week --
  -- Tuesday's card: the most recent week with a result, mine and the league's.
  if v_team.id is not null then
    select jsonb_build_object(
      'week', m.week,
      'my_points',  round(case when m.home_team_id = v_team.id then m.home_points else m.away_points end, 2),
      'opp_points', round(case when m.home_team_id = v_team.id then m.away_points else m.home_points end, 2),
      'opponent', jsonb_build_object('team_id', o.id, 'name', o.name, 'manager_name', o.manager_name, 'logo_path', o.logo_path),
      'league_high', (
        select jsonb_build_object('team_id', t2.id, 'name', t2.name, 'manager_name', t2.manager_name, 'points', hi.pts)
          from (select m2.home_team_id as tid, m2.home_points as pts from matchups m2 where m2.league_id = p_league_id and m2.week = m.week
                union all
                select m2.away_team_id, m2.away_points from matchups m2 where m2.league_id = p_league_id and m2.week = m.week
                order by pts desc limit 1) hi
          join teams t2 on t2.id = hi.tid
      ),
      'my_week_rank', (
        select count(*) + 1
          from (select m2.home_points as pts from matchups m2 where m2.league_id = p_league_id and m2.week = m.week
                union all
                select m2.away_points from matchups m2 where m2.league_id = p_league_id and m2.week = m.week) w
         where w.pts > case when m.home_team_id = v_team.id then m.home_points else m.away_points end
      ),
      'top_scorer', (
        select jsonb_build_object('full_name', p.full_name, 'position', p.position, 'points', rp.points)
          from roster_points rp join players p on p.id = rp.player_id
         where rp.team_id = v_team.id and rp.week = m.week and rp.slot <> 'BN'
         order by rp.points desc limit 1
      )
    ) into v_last
    from matchups m
    join teams o on o.id = case when m.home_team_id = v_team.id then m.away_team_id else m.home_team_id end
    where m.league_id = p_league_id and v_team.id in (m.home_team_id, m.away_team_id)
      and m.home_points + m.away_points > 0
      and (m.week < v_week
           or coalesce((v_games->>'final')::int, 0) >= coalesce((v_games->>'total')::int, 1))
    order by m.week desc limit 1;
  end if;

  -- -------------------------------------------------------------- history --
  -- All-time against tonight's opponent, by manager name, with the streak and
  -- the last meeting. This is the line nobody else can write.
  if v_opp.id is not null then
    v_my_name  := coalesce(v_team.manager_name, v_team.name);
    v_opp_name := coalesce(v_opp.manager_name, v_opp.name);

    with g as (
      select a.season, a.week, a.round,
             case when a.home_manager = v_my_name then a.home_points else a.away_points end as my,
             case when a.home_manager = v_my_name then a.away_points else a.home_points end as theirs
        from public.ff_all_games(p_league_id) a
       where a.played
         and ((a.home_manager = v_my_name and a.away_manager = v_opp_name)
           or (a.home_manager = v_opp_name and a.away_manager = v_my_name))
    ),
    ordered as (
      select *, case when my > theirs then 'W' when my < theirs then 'L' else 'T' end as k
        from g
    )
    select jsonb_build_object(
      'wins',   count(*) filter (where k = 'W'),
      'losses', count(*) filter (where k = 'L'),
      'ties',   count(*) filter (where k = 'T'),
      'games',  count(*),
      'streak', public.ff_streak((select array_agg(k order by season desc, week desc) from ordered)),
      'last', (select jsonb_build_object('season', season, 'week', week, 'round', round,
                                         'my', my, 'theirs', theirs, 'won', my > theirs)
                 from ordered order by season desc, week desc limit 1),
      'playoff_meetings', count(*) filter (where round <> 'regular'),
      'seasons_on_file', (select count(distinct season) from league_history where league_id = p_league_id)
    ) into v_history
    from ordered;
  else
    select jsonb_build_object(
      'seasons_on_file', (select count(distinct season) from league_history where league_id = p_league_id)
    ) into v_history;
  end if;

  -- ---------------------------------------------------------------- board --
  -- The week's other tables, for the carousel, with both projections.
  select coalesce(jsonb_agg(x order by (x->>'mine')::boolean desc, x->>'id'), '[]'::jsonb) into v_board
  from (
    select jsonb_build_object(
      'id', m.id, 'week', m.week,
      'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
      'home_points', round(m.home_points, 2), 'away_points', round(m.away_points, 2),
      'home_proj', (select round(coalesce(sum(public.ff_score(pj.stats, v_rules)), 0), 2)
                      from rosters r join player_projections pj on pj.player_id = r.player_id
                       and pj.season = v_league.season and pj.season_type = 2 and pj.week = v_week and pj.source = 'sleeper'
                     where r.team_id = m.home_team_id and r.week = v_week and r.slot <> 'BN'),
      'away_proj', (select round(coalesce(sum(public.ff_score(pj.stats, v_rules)), 0), 2)
                      from rosters r join player_projections pj on pj.player_id = r.player_id
                       and pj.season = v_league.season and pj.season_type = 2 and pj.week = v_week and pj.source = 'sleeper'
                     where r.team_id = m.away_team_id and r.week = v_week and r.slot <> 'BN'),
      'mine', (v_team.id is not null and v_team.id in (m.home_team_id, m.away_team_id))
    ) as x
    from matchups m
    where m.league_id = p_league_id and m.week = v_week
  ) q;

  -- --------------------------------------------------------------- lineup --
  -- What the Thursday nag is about: empty slots, byes and hurt starters.
  if v_team.id is not null then
    with slots as (
      select count(*) as n from jsonb_array_elements_text(v_league.roster_slots) x where x <> 'BN'
    ),
    st as (
      select r.player_id, p.full_name, p.bye_week, p.status,
             (select i.severity from nfl_injuries i where i.player_id = r.player_id limit 1) as severity
        from rosters r join players p on p.id = r.player_id
       where r.team_id = v_team.id and r.week = v_week and r.slot <> 'BN'
    )
    select jsonb_build_object(
      'starters', (select count(*) from st),
      'slots', (select n from slots),
      'empty_slots', greatest(0, (select n from slots) - (select count(*) from st)),
      'on_bye', coalesce((select jsonb_agg(full_name) from st where bye_week = v_week), '[]'::jsonb),
      'hurt', coalesce((select jsonb_agg(jsonb_build_object('full_name', full_name, 'severity', severity))
                          from st where severity in ('out','doubtful','questionable')), '[]'::jsonb),
      'has_roster', exists (select 1 from rosters r where r.team_id = v_team.id and r.week = v_week)
    ) into v_lineup;
  end if;

  return jsonb_build_object(
    'league', jsonb_build_object(
      'id', v_league.id, 'name', v_league.name, 'season', v_league.season,
      'team_count', v_league.team_count,
      'regular_season_weeks', v_reg,
      'playoff_teams', coalesce((v_league.settings->>'playoff_teams')::int, 6),
      'playoff_byes',  coalesce((v_league.settings->>'playoff_byes')::int, 0),
      'waiver_run_day', coalesce(v_league.settings->>'waiver_run_day', 'wednesday'),
      'is_commissioner', (v_league.commissioner_id = v_uid)
    ),
    'week',      v_week,
    'me',        v_me,
    'draft',     v_draft,
    'games',     v_games,
    'matchup',   v_matchup,
    'last',      v_last,
    'history',   v_history,
    'standings', v_standings,
    'board',     v_board,
    'lineup',    v_lineup,
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'manager_name', t.manager_name, 'logo_path', t.logo_path
              ) order by t.draft_slot), '[]'::jsonb) from teams t where t.league_id = p_league_id),
    'now',          now(),
    'generated_at', now()
  );
end $$;

revoke all on function public.ff_briefing(uuid) from public, anon;
grant execute on function public.ff_briefing(uuid) to authenticated;

comment on function public.ff_briefing(uuid) is
  'Members only. Everything the home screen says in one call: my matchup with live and projected totals and each starter''s game state, my record and seed, all-time head-to-head against tonight''s opponent, last week''s result, the week''s slate, lineup problems, and the NFL calendar the day-of-week personality is decided from.';

-- ---------------------------------------------------------------- history --

create or replace function public.ff_history(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_league    leagues%rowtype;
  v_managers  jsonb;
  v_grid      jsonb;
  v_seasons   jsonb;
  v_streaks   jsonb;
  v_blowouts  jsonb;
  v_highs     jsonb;
  v_rivalries jsonb;
  v_games     integer;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if v_uid is not null
     and not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  select count(*) into v_games from public.ff_all_games(p_league_id) where played;

  -- ---------------------------------------------------------------- seasons --
  -- The champion is whoever won the round called 'final'. A season with no
  -- final on record (this one, or an import without playoffs) reports who led.
  select coalesce(jsonb_agg(x order by (x->>'season')::int desc), '[]'::jsonb) into v_seasons
  from (
    select jsonb_build_object(
      'season', s.season,
      'games', (select count(*) from public.ff_all_games(p_league_id) f where f.played and f.season = s.season),
      'champion', (select case when home_points > away_points then home_manager else away_manager end
                     from public.ff_all_games(p_league_id) f
                    where f.played and f.season = s.season and f.round = 'final' order by week desc limit 1),
      'runner_up', (select case when home_points > away_points then away_manager else home_manager end
                      from public.ff_all_games(p_league_id) f
                     where f.played and f.season = s.season and f.round = 'final' order by week desc limit 1),
      'final_score', (select jsonb_build_object('w', greatest(home_points, away_points), 'l', least(home_points, away_points))
                        from public.ff_all_games(p_league_id) f
                       where f.played and f.season = s.season and f.round = 'final' order by week desc limit 1),
      'in_progress', (s.season = v_league.season),
      'best_record', (select jsonb_build_object('manager', manager, 'wins', w, 'losses', l)
                        from (select manager,
                                     count(*) filter (where pf > pa) as w,
                                     count(*) filter (where pf < pa) as l,
                                     sum(pf) as pts
                                from public.ff_all_sides(p_league_id)
                               where season = s.season and round = 'regular'
                               group by manager order by w desc, pts desc limit 1) b)
    ) as x
    from (select distinct season from public.ff_all_games(p_league_id) where played) s
  ) q;

  -- --------------------------------------------------------------- managers --
  select coalesce(jsonb_agg(x order by (x->>'titles')::int desc, (x->>'wins')::int desc, (x->>'points_for')::numeric desc), '[]'::jsonb)
    into v_managers
  from (
    select jsonb_build_object(
      'manager', m.manager,
      'seasons', count(distinct m.season),
      'wins',   count(*) filter (where m.pf > m.pa),
      'losses', count(*) filter (where m.pf < m.pa),
      'ties',   count(*) filter (where m.pf = m.pa),
      'points_for', round(sum(m.pf), 1),
      'points_against', round(sum(m.pa), 1),
      'avg', round(avg(m.pf), 1),
      'titles', (select count(*) from public.ff_all_games(p_league_id) f where f.played and f.round = 'final'
                   and ((f.home_manager = m.manager and f.home_points > f.away_points)
                     or (f.away_manager = m.manager and f.away_points > f.home_points))),
      'finals', (select count(*) from public.ff_all_games(p_league_id) f where f.played and f.round = 'final'
                   and m.manager in (f.home_manager, f.away_manager)),
      'playoff_games', count(*) filter (where m.round <> 'regular'),
      'best_week', (select jsonb_build_object('season', z.season, 'week', z.week, 'points', z.pf)
                      from public.ff_all_sides(p_league_id) z where z.manager = m.manager order by z.pf desc limit 1),
      'title_years', (select coalesce(jsonb_agg(f.season order by f.season), '[]'::jsonb)
                        from public.ff_all_games(p_league_id) f where f.played and f.round = 'final'
                         and ((f.home_manager = m.manager and f.home_points > f.away_points)
                           or (f.away_manager = m.manager and f.away_points > f.home_points))),
      'current_team', (select t.name from teams t where t.league_id = p_league_id and coalesce(t.manager_name, t.name) = m.manager limit 1),
      'team_id',      (select t.id from teams t where t.league_id = p_league_id and coalesce(t.manager_name, t.name) = m.manager limit 1),
      'logo_path',    (select t.logo_path from teams t where t.league_id = p_league_id and coalesce(t.manager_name, t.name) = m.manager limit 1)
    ) as x
    from public.ff_all_sides(p_league_id) m group by m.manager
  ) q;

  -- ------------------------------------------------------------------- grid --
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_grid
  from (
    select jsonb_build_object(
      'manager', manager, 'opponent', opponent,
      'wins', count(*) filter (where pf > pa),
      'losses', count(*) filter (where pf < pa),
      'ties', count(*) filter (where pf = pa)
    ) as x
    from public.ff_all_sides(p_league_id) group by manager, opponent
  ) q;

  -- ---------------------------------------------------------------- streaks --
  -- The longest runs of wins by anyone, across seasons.
  with ordered as (
    select manager, season, week, (pf > pa) as won,
           row_number() over (partition by manager order by season, week) as rn
      from public.ff_all_sides(p_league_id)
  ),
  grp as (
    select *, rn - row_number() over (partition by manager, won order by season, week) as g
      from ordered
  )
  select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]'::jsonb) into v_streaks
  from (
    select jsonb_build_object('manager', manager, 'n', count(*),
             'from', jsonb_build_object('season', min(season), 'week', min(week)),
             'to',   jsonb_build_object('season', max(season), 'week', max(week))) as x
      from grp where won group by manager, g order by count(*) desc limit 5
  ) q;

  -- --------------------------------------------------------------- blowouts --
  select coalesce(jsonb_agg(x order by (x->>'margin')::numeric desc), '[]'::jsonb) into v_blowouts
  from (
    select jsonb_build_object('season', season, 'week', week, 'round', round,
             'winner', case when home_points > away_points then home_manager else away_manager end,
             'loser',  case when home_points > away_points then away_manager else home_manager end,
             'w', greatest(home_points, away_points), 'l', least(home_points, away_points),
             'margin', abs(home_points - away_points)) as x
      from public.ff_all_games(p_league_id) where played
      order by abs(home_points - away_points) desc limit 5
  ) q;

  select coalesce(jsonb_agg(x order by (x->>'points')::numeric desc), '[]'::jsonb) into v_highs
  from (
    select jsonb_build_object('season', season, 'week', week, 'manager', manager, 'points', pf, 'opponent', opponent) as x
      from public.ff_all_sides(p_league_id) order by pf desc limit 5
  ) q;

  -- -------------------------------------------------------------- rivalries --
  -- A rivalry is a pair that has met often and split it: many games, a close
  -- record, a small average margin, and playoff meetings count double.
  select coalesce(jsonb_agg(x order by (x->>'score')::numeric desc), '[]'::jsonb) into v_rivalries
  from (
    select jsonb_build_object(
      'a', a, 'b', b, 'games', games, 'a_wins', aw, 'b_wins', bw, 'playoff', po,
      'avg_margin', round(margin, 1),
      'score', round(games + po * 2 - abs(aw - bw) * 1.5 - margin / 10, 2)
    ) as x
    from (
      select least(home_manager, away_manager) as a, greatest(home_manager, away_manager) as b,
             count(*) as games,
             count(*) filter (where (home_manager < away_manager and home_points > away_points)
                                 or (home_manager > away_manager and away_points > home_points)) as aw,
             count(*) filter (where (home_manager < away_manager and home_points < away_points)
                                 or (home_manager > away_manager and away_points < home_points)) as bw,
             count(*) filter (where round <> 'regular') as po,
             avg(abs(home_points - away_points)) as margin
        from public.ff_all_games(p_league_id) where played
       group by 1, 2
    ) p
    where games >= 3
    order by games + po * 2 - abs(aw - bw) * 1.5 - margin / 10 desc limit 4
  ) q;

  return jsonb_build_object(
    'league', jsonb_build_object('id', v_league.id, 'name', v_league.name, 'season', v_league.season, 'est', 2016),
    'games',     v_games,
    'seasons',   v_seasons,
    'managers',  v_managers,
    'grid',      v_grid,
    'streaks',   v_streaks,
    'blowouts',  v_blowouts,
    'highs',     v_highs,
    'rivalries', v_rivalries,
    'generated_at', now()
  );
end $$;

revoke all on function public.ff_history(uuid) from public, anon;
grant execute on function public.ff_history(uuid) to authenticated;

comment on function public.ff_history(uuid) is
  'Members only. The history wall: champions by season, all-time records and titles per manager, the head-to-head grid, longest win streaks, biggest blowouts, highest scores and auto-detected rivalries. Past seasons from league_history plus the current one from matchups.';

-- ------------------------------------------------------------- share card --

create or replace function public.ff_share_card(p_matchup_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'league', l.name,
    'season', l.season,
    'week',   m.week,
    'final',  (select count(*) filter (where g.status <> 'post') = 0
                 from nfl_games g where g.season = l.season and g.season_type = 2 and g.week = m.week),
    'home', jsonb_build_object('name', th.name, 'manager', th.manager_name, 'points', round(m.home_points, 2),
                               'crest', th.logo_path),
    'away', jsonb_build_object('name', ta.name, 'manager', ta.manager_name, 'points', round(m.away_points, 2),
                               'crest', ta.logo_path),
    'top', (select jsonb_build_object('full_name', p.full_name, 'position', p.position, 'points', rp.points,
                                      'team', case when rp.team_id = m.home_team_id then th.name else ta.name end)
              from roster_points rp join players p on p.id = rp.player_id
             where rp.week = m.week and rp.slot <> 'BN' and rp.team_id in (m.home_team_id, m.away_team_id)
             order by rp.points desc limit 1)
  )
  from matchups m
  join leagues l on l.id = m.league_id
  join teams th on th.id = m.home_team_id
  join teams ta on ta.id = m.away_team_id
  where m.id = p_matchup_id
$$;

revoke all on function public.ff_share_card(uuid) from public;
grant execute on function public.ff_share_card(uuid) to anon, authenticated;

comment on function public.ff_share_card(uuid) is
  'Callable without a session, on purpose: a card posted into the group chat has to unfurl for whoever taps it. Two names, two managers, two scores, the week and the top scorer for one matchup addressed by an unguessable id. Nothing else.';
