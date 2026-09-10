-- ============================================================================
-- A record waits for the week.
--
-- One Thursday night game, and by Friday five matchups had a winner and ten
-- teams had a record, because the standings called a matchup decided the moment
-- anybody in it had scored. This pins the rule that replaced it: a matchup is a
-- result once its NFL week is over — every game final, or four hours past the
-- last kickoff — and not before, however many points are on the board.
--
-- It checks the four readers that decide results, because they must agree:
-- the standings view, ff_all_games (history, rivalry, the briefing's form),
-- ff_playoff_outlook's played flag (the playoff odds and power rankings), and
-- ff_briefing's streak and last-week card.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_uid uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_m1 uuid; v_m2 uuid;
  v_early uuid; v_late uuid;
  v_j jsonb; v_row record;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  -- A week of two games: one kicked off last night and is over, one is Sunday.
  -- That is exactly the state that produced the wrong records.
  insert into nfl_teams (id, name, espn_id) values
    ('SEA', 'Standings Test', 'SEA'), ('NE', 'Standings Test Away', 'NE')
    on conflict (id) do nothing;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('standings-thu', 2026, 2, 7, 'SEA', 'NE', now() - interval '14 hours', 'post')
  returning id into v_early;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('standings-sun', 2026, 2, 7, 'NE', 'SEA', now() + interval '3 days', 'pre')
  returning id into v_late;

  insert into auth.users (email) values ('standings@example.test') returning id into v_uid;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Standings Test', 2026, v_uid, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Alpha', 'Ada', v_uid) returning id into v_a;
  insert into teams (league_id, name, manager_name) values (v_league, 'Bravo', 'Bo') returning id into v_b;
  insert into teams (league_id, name, manager_name) values (v_league, 'Charlie', 'Cy') returning id into v_c;
  insert into teams (league_id, name, manager_name) values (v_league, 'Delta', 'Di') returning id into v_d;

  -- Thursday's starters have scored: Alpha leads Bravo, Delta leads Charlie.
  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points)
  values (v_league, 7, v_a, v_b, 13.0, 7.0) returning id into v_m1;
  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points)
  values (v_league, 7, v_c, v_d, 0, 40.7) returning id into v_m2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  -- ------------------------------------------------- Friday morning: nothing --
  if public.ff_week_final(2026, 7) then
    raise exception 'a week with a game still to come was called final';
  end if;
  for v_row in select name, wins, losses, ties, points_for, points_against
                 from standings where league_id = v_league loop
    if v_row.wins <> 0 or v_row.losses <> 0 or v_row.ties <> 0 then
      raise exception '% is %-%-% with a game still to play', v_row.name, v_row.wins, v_row.losses, v_row.ties;
    end if;
    -- The live score is the scoreboard's to show. The table sums results.
    if v_row.points_for <> 0 or v_row.points_against <> 0 then
      raise exception '% has % points for in a week that is not over', v_row.name, v_row.points_for;
    end if;
  end loop;
  v_checks := v_checks + 2;

  if exists (select 1 from public.ff_all_games(v_league) where played) then
    raise exception 'ff_all_games called a game in progress played';
  end if;
  v_j := ff_playoff_outlook(v_league);
  if exists (select 1 from jsonb_array_elements(v_j->'matchups') m where (m->>'played')::boolean) then
    raise exception 'the outlook flagged a matchup played mid-week';
  end if;
  if exists (select 1 from jsonb_array_elements(v_j->'teams') t
              where jsonb_array_length(t->'scores') <> 0 or (t->>'wins')::int <> 0 or (t->>'losses')::int <> 0) then
    raise exception 'the outlook counted a score from a week still being played';
  end if;
  v_j := ff_briefing(v_league);
  if (v_j->'me'->'streak'->>'n')::int <> 0 or (v_j->'me'->>'wins')::int <> 0 then
    raise exception 'the briefing gave Ada a streak of % and % wins before the week ended',
      v_j->'me'->'streak'->>'n', v_j->'me'->>'wins';
  end if;
  if v_j->'last' is not null and v_j->'last' <> 'null'::jsonb then
    raise exception 'the briefing wrote a last-week card for a week still going: %', v_j->'last';
  end if;
  v_checks := v_checks + 5;

  -- --------------------------------------------- Tuesday: every game final --
  update nfl_games set status = 'post', kickoff_at = now() - interval '2 hours' where id = v_late;
  if not public.ff_week_final(2026, 7) then
    raise exception 'a week whose every game is final was not called final';
  end if;
  select wins, losses, points_for, points_against into v_row from standings where team_id = v_a;
  if v_row.wins <> 1 or v_row.losses <> 0 or v_row.points_for <> 13 or v_row.points_against <> 7 then
    raise exception 'Alpha is %-% with % for and % against, expected 1-0, 13 for, 7 against',
      v_row.wins, v_row.losses, v_row.points_for, v_row.points_against;
  end if;
  select wins, losses into v_row from standings where team_id = v_b;
  if v_row.wins <> 0 or v_row.losses <> 1 then
    raise exception 'Bravo is %-%, expected 0-1', v_row.wins, v_row.losses;
  end if;
  select wins, losses into v_row from standings where team_id = v_d;
  if v_row.wins <> 1 or v_row.losses <> 0 then
    raise exception 'Delta is %-%, expected 1-0', v_row.wins, v_row.losses;
  end if;
  if (select count(*) from public.ff_all_games(v_league) where played) <> 2 then
    raise exception 'ff_all_games did not count the finished week';
  end if;
  v_j := ff_playoff_outlook(v_league);
  if (select count(*) from jsonb_array_elements(v_j->'matchups') m where (m->>'played')::boolean) <> 2 then
    raise exception 'the outlook did not flag the finished week played';
  end if;
  v_j := ff_briefing(v_league);
  if v_j->'me'->'streak'->>'kind' <> 'W' or (v_j->'me'->'streak'->>'n')::int <> 1 then
    raise exception 'the briefing gave Ada a streak of % after one win', v_j->'me'->'streak';
  end if;
  if (v_j->'last'->>'week')::int <> 7 then
    raise exception 'the briefing''s last-week card is for week %', v_j->'last'->>'week';
  end if;
  v_checks := v_checks + 7;

  -- ------------------------------ the feed can lag: four hours past kickoff --
  -- A status stuck on 'in' does not hold the table hostage once the last game
  -- could not still be going. That is the margin ff_current_week moves on by.
  update nfl_games set status = 'in', kickoff_at = now() - interval '5 hours' where id = v_late;
  if not public.ff_week_final(2026, 7) then
    raise exception 'four hours past the last kickoff was not called final';
  end if;
  update nfl_games set status = 'in', kickoff_at = now() - interval '3 hours' where id = v_late;
  if public.ff_week_final(2026, 7) then
    raise exception 'a game three hours in was called final without the feed saying so';
  end if;
  v_checks := v_checks + 2;

  -- ------------------------------------- a finished week nobody scored --
  -- Week over, points never written: not a tie, not anything. The old rule's
  -- one good instinct, kept.
  update nfl_games set status = 'post', kickoff_at = now() - interval '2 hours' where id = v_late;
  update matchups set home_points = 0, away_points = 0 where id = v_m2;
  select wins, losses, ties into v_row from standings where team_id = v_c;
  if v_row.wins <> 0 or v_row.losses <> 0 or v_row.ties <> 0 then
    raise exception 'a week that was never scored became a %-%-% record', v_row.wins, v_row.losses, v_row.ties;
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------ a week with no games at all --
  if public.ff_week_final(2026, 99) then
    raise exception 'a week with no games on record was called final';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- who may ask --
  -- The standings view runs as its reader, so a manager needs the predicate;
  -- anon does not get it, like everything else in public.
  if not has_function_privilege('authenticated', 'public.ff_week_final(integer,integer)', 'execute') then
    raise exception 'a signed-in manager cannot evaluate ff_week_final, so cannot read the standings';
  end if;
  if has_function_privilege('anon', 'public.ff_week_final(integer,integer)', 'execute') then
    raise exception 'anon can execute ff_week_final';
  end if;
  v_checks := v_checks + 2;

  raise notice 'standings: % checks passed', v_checks;
end $$;

rollback;
