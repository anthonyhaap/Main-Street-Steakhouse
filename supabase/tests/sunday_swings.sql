-- ============================================================================
-- Game Day 2.0: monster games and deficits cut close.
--
-- `20261002023710_sunday_swings` writes two events after the detector and the
-- moments pass. The ways that goes wrong are the usual quiet ones: a monster
-- game credited to the team that benched him, the same squeeze told every
-- minute, a squeeze told for a game that is already over, a threshold tuned
-- and ignored, a service function reachable from the browser.
--
-- Season 2032, so nothing else in the replay's slate can make a week final.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_ada uuid; v_bo uuid;
  t_ada uuid; t_bo uuid;
  v_m uuid;
  v_star uuid; v_sat uuid;
  v_e sunday_events%rowtype;
  v_n integer;
  v_checks integer := 0;
  v_season constant integer := 2032;
begin
  insert into auth.users (email) values ('sw-ada@example.test') returning id into v_ada;
  insert into auth.users (email) values ('sw-bo@example.test')  returning id into v_bo;
  insert into leagues (name, season, team_count, commissioner_id, roster_slots)
  values ('Swings Test', v_season, 2, v_ada, '["WR"]'::jsonb) returning id into v_league;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada Lovelace', v_ada) returning id into t_ada;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_bo)            returning id into t_bo;
  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, 3, t_ada, t_bo) returning id into v_m;

  insert into players (full_name, position, nfl_team) values ('Swing Star', 'WR', null) returning id into v_star;
  insert into players (full_name, position, nfl_team) values ('Swing Sitter', 'WR', null) returning id into v_sat;
  insert into rosters (team_id, player_id, week, slot) values (t_ada, v_star, 3, 'WR'), (t_bo, v_sat, 3, 'BN');

  -- The detector's state, as it would have written it: Bo leads by 20.
  insert into sunday_matchup_state (matchup_id, league_id, leader, home_points, away_points, away_worst, home_worst)
  values (v_m, v_league, 'away', 40, 60, 0, 20);
  insert into sunday_player_state (league_id, season, week, team_id, player_id, points) values
    (v_league, v_season, 3, t_ada, v_star, 12), (v_league, v_season, 3, t_bo, v_sat, 33);

  -- ------------------------------------------------------------- nothing --
  v_n := public.ff_sunday_swings(v_league, 3);
  if v_n <> 0 then raise exception 'nothing had happened, but % swings were written (a benched 33 counts for nobody)', v_n; end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- the squeeze and the star --
  -- Ada's receiver goes for 31 and Ada is within 3 of Bo: one monster game,
  -- one squeeze, from 20 down.
  update sunday_player_state set points = 31 where player_id = v_star;
  update sunday_matchup_state set home_points = 57, away_points = 60 where matchup_id = v_m;
  v_n := public.ff_sunday_swings(v_league, 3);
  if v_n <> 2 then raise exception 'expected a monster game and a squeeze, got %', v_n; end if;

  select * into v_e from sunday_events where league_id = v_league and event_type = 'monster_game';
  if v_e.team_id <> t_ada or v_e.player_id <> v_star or v_e.level <> 3
     or v_e.headline <> 'Swing Star — monster game' or v_e.description <> '31.0 points for Ada'
     or v_e.new_score <> 57 or v_e.opp_new_score <> 60 then
    raise exception 'monster game wrong: % / % / % / %', v_e.headline, v_e.description, v_e.new_score, v_e.opp_new_score;
  end if;
  select * into v_e from sunday_events where league_id = v_league and event_type = 'tightening';
  if v_e.team_id <> t_ada or v_e.opponent_team_id <> t_bo
     or v_e.headline <> 'Ada cuts Bo''s lead to 3.0' or v_e.description <> 'Was down 20.0'
     or (v_e.detail->>'from')::numeric <> 20 then
    raise exception 'squeeze wrong: % / % / %', v_e.headline, v_e.description, v_e.detail;
  end if;
  v_checks := v_checks + 3;

  -- The same look again, and the same lead opening up and closing again:
  -- nothing new.
  v_n := public.ff_sunday_swings(v_league, 3);
  update sunday_matchup_state set home_points = 45 where matchup_id = v_m;
  v_n := v_n + public.ff_sunday_swings(v_league, 3);
  update sunday_matchup_state set home_points = 58 where matchup_id = v_m;
  v_n := v_n + public.ff_sunday_swings(v_league, 3);
  if v_n <> 0 then raise exception 'the same squeeze under the same lead was told % more times', v_n; end if;
  v_checks := v_checks + 1;

  -- A new lead is a new story. Ada goes ahead by two; Bo, never down by
  -- fifteen, is not "cutting" anything. Once Bo's worst is 18, he is — once.
  update sunday_matchup_state set leader = 'home', lead_changes = 1, home_points = 62, away_points = 60 where matchup_id = v_m;
  v_n := public.ff_sunday_swings(v_league, 3);
  if v_n <> 0 then raise exception 'a side never fifteen down was told as a squeeze'; end if;
  update sunday_matchup_state set away_worst = 18 where matchup_id = v_m;
  v_n := public.ff_sunday_swings(v_league, 3);
  if v_n <> 1 or (select count(*) from sunday_events where league_id = v_league and event_type = 'tightening') <> 2 then
    raise exception 'a squeeze under the new lead should be told once, got %', v_n;
  end if;
  v_checks := v_checks + 2;

  -- --------------------------------------------------------- over is over --
  update sunday_matchup_state set lead_changes = 2, final_fired = true where matchup_id = v_m;
  v_n := public.ff_sunday_swings(v_league, 3);
  if v_n <> 0 then raise exception 'a finished game was told as a squeeze'; end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ the dials --
  perform set_config('request.jwt.claims', json_build_object('sub', v_ada)::text, true);
  perform public.ff_set_sunday_weights(v_league, '{"monster_points": 40, "tightening_from": 25}'::jsonb);
  perform set_config('request.jwt.claims', '', true);
  if (public.ff_sunday_weights(v_league)->>'monster_points')::int <> 40 then
    raise exception 'monster_points did not take';
  end if;
  delete from sunday_events where league_id = v_league;
  update sunday_matchup_state set final_fired = false where matchup_id = v_m;
  v_n := public.ff_sunday_swings(v_league, 3);
  if v_n <> 0 then raise exception 'tuned thresholds were ignored: % written', v_n; end if;
  v_checks := v_checks + 2;

  -- -------------------------------------------------------- the payload --
  -- ff_sunday carries the new kinds like any other, the player named.
  update leagues set settings = settings - 'sunday_weights' where id = v_league;
  perform public.ff_sunday_swings(v_league, 3);
  perform set_config('request.jwt.claims', json_build_object('sub', v_bo)::text, true);
  if not exists (select 1 from jsonb_array_elements(public.ff_sunday(v_league, 3)->'events') x
                  where x->>'type' = 'monster_game' and x->>'player_name' = 'Swing Star') then
    raise exception 'ff_sunday does not carry the monster game';
  end if;
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------------- doors --
  if has_function_privilege('authenticated', 'public.ff_sunday_swings(uuid,integer)', 'execute')
     or has_function_privilege('anon', 'public.ff_sunday_swings(uuid,integer)', 'execute') then
    raise exception 'ff_sunday_swings is reachable from the browser';
  end if;
  v_checks := v_checks + 1;

  raise notice 'sunday swings: % checks passed', v_checks;
end $$;

rollback;
