-- ============================================================================
-- The games keep up.
--
-- The scoreboard showed projections all through a game that had been played.
-- The points were there — ff_poll_live had loaded them, the matchup totals
-- were right — and the card would not print them, because every starter's game
-- still read `pre`. It read `pre` because nothing ever changed it: the only
-- writer of nfl_games.status was ff_load_nfl_schedule, run once on 2026-08-10
-- and on no cron since. Every game in the season was "not started" for ever,
-- so every card was "nobody has kicked", so every number was a projection.
--
-- The stats poll already asks Sleeper every two minutes while a game is on.
-- Now it asks ESPN for the same week first — one request, the scoreboard
-- endpoint the schedule was loaded from — and writes each game's state,
-- detail and kickoff back. `in` and `post` arrive the way the points do.
-- The nightly settle does the same for its weeks, and a daily job refreshes
-- the whole schedule, which is also what catches a flexed Sunday night game
-- before the lineup lock does not.
--
-- ff_load_nfl_week is the one-week half of ff_load_nfl_schedule, split out so
-- the poll can call it without eighteen requests. Both are service-only:
-- ff_load_nfl_schedule was callable by any signed-in manager, which would let
-- one rewrite every kickoff time in the season from the browser console.
-- ============================================================================

-- ------------------------------------------------------------- one week --

create or replace function public.ff_load_nfl_week(p_season integer, p_week integer)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_body text; v_n integer := 0;
begin
  select content into v_body from extensions.http_get(format(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=%s&seasontype=2&week=%s',
    p_season, p_week));
  if v_body is null then return 0; end if;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail, updated_at)
  select e->>'id', p_season, 2, p_week,
         ht.abbr, at.abbr,
         (e->>'date')::timestamptz,
         e->'competitions'->0->'status'->'type'->>'state',
         e->'competitions'->0->'status'->'type'->>'shortDetail',
         now()
  from jsonb_array_elements((v_body::jsonb)->'events') e
  cross join lateral (
    select coalesce(t.espn_id, t.id) as espn, t.id as abbr from nfl_teams t
    where coalesce(t.espn_id, t.id) = (
      select c->'team'->>'abbreviation' from jsonb_array_elements(e->'competitions'->0->'competitors') c
      where c->>'homeAway' = 'home')) ht
  cross join lateral (
    select t.id as abbr from nfl_teams t
    where coalesce(t.espn_id, t.id) = (
      select c->'team'->>'abbreviation' from jsonb_array_elements(e->'competitions'->0->'competitors') c
      where c->>'homeAway' = 'away')) at
  on conflict (espn_event_id) do update
    set kickoff_at = excluded.kickoff_at, status = excluded.status,
        status_detail = excluded.status_detail, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.ff_load_nfl_week(integer, integer) from public, anon, authenticated;

comment on function public.ff_load_nfl_week(integer, integer) is
  'Service only. Upserts one NFL week from the ESPN scoreboard: kickoff, state (pre/in/post) and detail. The live poll and the nightly settle call it; ff_load_nfl_schedule loops it.';

-- -------------------------------------------------------- the whole season --
-- Restated to loop the function above. Same rows, same log line.

create or replace function public.ff_load_nfl_schedule(p_season integer default 2026, p_weeks integer default 18)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_n integer; w integer;
begin
  for w in 1..p_weeks loop
    perform public.ff_load_nfl_week(p_season, w);
  end loop;

  select count(*) into v_n from nfl_games where season = p_season and season_type = 2;
  insert into ingest_log (source, event, detail)
  values ('espn','schedule_loaded', jsonb_build_object('season',p_season,'games',v_n));
  return v_n;
end $$;

revoke all on function public.ff_load_nfl_schedule(integer, integer) from public, anon, authenticated;

-- ------------------------------------------------------------ the live poll --
-- Restated in full. The change is the ESPN refresh before the stats load,
-- guarded so a bad ESPN minute never costs the points.

create or replace function public.ff_poll_live()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_season int; v_week int;
  v_lines int; v_unmapped int;
  v_league uuid; v_updated int := 0; v_games int := 0;
begin
  -- Only work when there are games in a live window: kicked off within the last
  -- 6 hours, or starting within 15 minutes (so we are warm at kickoff).
  select g.season, g.week into v_season, v_week
  from nfl_games g
  where g.season_type = 2
    and g.kickoff_at between now() - interval '6 hours' and now() + interval '15 minutes'
  group by g.season, g.week
  order by count(*) desc, g.week
  limit 1;

  if v_week is null then
    return jsonb_build_object('polled', false, 'reason', 'no games in live window');
  end if;

  -- The state of every game in the week: what has kicked, what is final. This
  -- is what turns a projection into a score on the board.
  begin
    v_games := public.ff_load_nfl_week(v_season, v_week);
  exception when others then
    insert into ingest_log (source, event, detail)
    values ('espn', 'games_refresh_failed',
            jsonb_build_object('season', v_season, 'week', v_week, 'error', sqlerrm));
  end;

  begin
    select lines, unmapped into v_lines, v_unmapped
    from ff_load_sleeper_stats(v_season, v_week, 'regular');
  exception when others then
    insert into ingest_log (source, event, detail)
    values ('sleeper', 'live_poll_failed',
            jsonb_build_object('season', v_season, 'week', v_week, 'error', sqlerrm));
    return jsonb_build_object('polled', false, 'error', sqlerrm);
  end;

  for v_league in select id from leagues loop
    v_updated := v_updated + coalesce(ff_recompute_week(v_league, v_week), 0);
  end loop;

  insert into ingest_log (source, event, detail)
  values ('sleeper', 'live_poll',
          jsonb_build_object('season', v_season, 'week', v_week, 'lines', v_lines,
                             'unmapped', v_unmapped, 'matchups', v_updated, 'games', v_games));

  return jsonb_build_object('polled', true, 'season', v_season, 'week', v_week,
                            'lines', v_lines, 'matchups', v_updated, 'games', v_games);
end;
$$;

-- ------------------------------------------------------------- the settle --
-- Restated in full. Each recent week's games are refreshed with its stats.

create or replace function public.ff_settle_recent_weeks()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record; v_lines int; v_unmapped int;
  v_league uuid; v_done jsonb := '[]'::jsonb;
begin
  for r in
    select g.season, g.week
    from nfl_games g
    where g.season_type = 2
      and g.kickoff_at between now() - interval '10 days' and now()
    group by g.season, g.week
    order by g.week
  loop
    begin
      perform public.ff_load_nfl_week(r.season, r.week);
    exception when others then
      insert into ingest_log (source, event, detail)
      values ('espn', 'games_refresh_failed',
              jsonb_build_object('season', r.season, 'week', r.week, 'error', sqlerrm));
    end;
    begin
      select lines, unmapped into v_lines, v_unmapped
      from ff_load_sleeper_stats(r.season, r.week, 'regular');

      for v_league in select id from leagues loop
        perform ff_recompute_week(v_league, r.week);
      end loop;

      v_done := v_done || jsonb_build_object('week', r.week, 'lines', v_lines);
    exception when others then
      insert into ingest_log (source, event, detail)
      values ('sleeper', 'settle_failed',
              jsonb_build_object('season', r.season, 'week', r.week, 'error', sqlerrm));
    end;
  end loop;

  insert into ingest_log (source, event, detail)
  values ('sleeper', 'settled', jsonb_build_object('weeks', v_done));
  return v_done;
end;
$$;

revoke all on function public.ff_poll_live() from public, anon, authenticated;
revoke all on function public.ff_settle_recent_weeks() from public, anon, authenticated;

-- ------------------------------------------------------------- every day --
-- The whole season, once a day, before the roster roll at 09:20. Kickoffs
-- move — a flexed Sunday night, a hurricane — and the lineup lock reads them.
select cron.schedule('schedule-refresh', '0 9 * * *', 'select public.ff_load_nfl_schedule()');
