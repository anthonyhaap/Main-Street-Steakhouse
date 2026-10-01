-- ============================================================================
-- Steakhouse Sunday, phase 4: what the league knows, and the rare moments.
--
-- `20261001034741_sunday_intelligence` hands the page the facts its storylines
-- are written from, lets the commissioner tune the excitement weights, and
-- writes three Steakhouse moments the detector could not see. The ways that
-- goes wrong are quiet ones: a streak counted across a week that was not over,
-- a series that includes the game being played, a record "set" by somebody
-- who is not even top today, a comeback told twice, a weight tuned to 9000 or
-- by somebody who is not the commissioner. So those are what this checks.
--
-- Season 2031, so nothing else in the replay's slate can make a week final.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_ada uuid; v_bo uuid; v_cy uuid; v_di uuid;
  t_ada uuid; t_bo uuid; t_cy uuid; t_di uuid;
  v_m3a uuid; v_m3b uuid;
  v_j jsonb; v_i jsonb; v_t jsonb; v_e sunday_events%rowtype;
  v_n integer;
  v_checks integer := 0;
  v_failed boolean;
  v_season constant integer := 2031;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values ('SIA','Alphas','SIA'), ('SIB','Betas','SIB')
  on conflict (id) do nothing;
  -- Weeks 1 and 2 are over; week 3 is on.
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status, status_detail)
  values ('si-1', v_season, 2, 1, 'SIA', 'SIB', now() - interval '14 days', 'post', 'Final'),
         ('si-2', v_season, 2, 2, 'SIA', 'SIB', now() - interval '7 days',  'post', 'Final'),
         ('si-3', v_season, 2, 3, 'SIA', 'SIB', now() - interval '2 hours', 'in',   '8:14 - 4th');

  insert into auth.users (email) values ('si-ada@example.test') returning id into v_ada;
  insert into auth.users (email) values ('si-bo@example.test')  returning id into v_bo;
  insert into auth.users (email) values ('si-cy@example.test')  returning id into v_cy;
  insert into auth.users (email) values ('si-di@example.test')  returning id into v_di;

  insert into leagues (name, season, team_count, commissioner_id, roster_slots, settings)
  values ('Intel Test', v_season, 4, v_ada, '["QB"]'::jsonb, '{"playoff_teams": 2}'::jsonb)
  returning id into v_league;
  insert into league_scoring_rules (league_id, effective_from_week, rules)
  values (v_league, 1, '{"rec":1,"rec_yd":0.1,"rec_td":6}'::jsonb);

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada Lovelace', v_ada) returning id into t_ada;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_bo)            returning id into t_bo;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Charlie', 'Cy', v_cy)          returning id into t_cy;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Delta', 'Di', v_di)            returning id into t_di;

  -- Week 1: Ada beats Bo, Di beats Cy. Week 2: Ada beats Cy, Bo beats Di 140-80.
  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points) values
    (v_league, 1, t_ada, t_bo, 120, 100), (v_league, 1, t_cy, t_di, 90, 95),
    (v_league, 2, t_ada, t_cy, 130, 110), (v_league, 2, t_bo, t_di, 140, 80);
  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, 3, t_ada, t_cy) returning id into v_m3a;
  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, 3, t_bo, t_di) returning id into v_m3b;

  -- Ada and Cy before this season: Cy won in 2029, Ada twice in 2030.
  insert into league_history (league_id, season, week, home_manager, away_manager, home_points, away_points) values
    (v_league, 2029, 3, 'Cy', 'Ada Lovelace', 110, 100),
    (v_league, 2030, 5, 'Ada Lovelace', 'Cy', 120, 90),
    (v_league, 2030, 9, 'Cy', 'Ada Lovelace', 80, 101);

  -- -------------------------------------------------------------- weights --
  perform set_config('request.jwt.claims', json_build_object('sub', v_ada)::text, true);
  v_j := public.ff_sunday_weights(v_league);
  if (v_j->>'touchdown')::int <> 20 or (v_j->>'comeback_points')::int <> 20 or (v_j->>'in_action')::int <> 2 then
    raise exception 'defaults wrong: %', v_j;
  end if;
  v_j := public.ff_set_sunday_weights(v_league, '{"touchdown": 30, "rivalry": 25}'::jsonb);
  if (v_j->>'touchdown')::int <> 30 or (v_j->>'rivalry')::int <> 25 or (v_j->>'within1')::int <> 40 then
    raise exception 'tuning did not take: %', v_j;
  end if;
  -- Back to the default, and a null: both leave no override behind.
  perform public.ff_set_sunday_weights(v_league, '{"touchdown": 20, "rivalry": null}'::jsonb);
  if (select settings ? 'sunday_weights' from leagues where id = v_league) then
    raise exception 'a default was stored as an override: %', (select settings from leagues where id = v_league);
  end if;
  v_checks := v_checks + 3;

  v_failed := false;
  begin perform public.ff_set_sunday_weights(v_league, '{"vibes": 10}'::jsonb);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'an unknown weight was accepted'; end if;
  v_failed := false;
  begin perform public.ff_set_sunday_weights(v_league, '{"touchdown": 9000}'::jsonb);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a weight out of bounds was accepted'; end if;
  v_failed := false;
  begin perform public.ff_set_sunday_weights(v_league, '{"touchdown": 12.5}'::jsonb);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a fractional weight was accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_bo)::text, true);
  v_failed := false;
  begin perform public.ff_set_sunday_weights(v_league, '{"touchdown": 30}'::jsonb);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a manager who is not the commissioner tuned the page'; end if;
  v_checks := v_checks + 4;

  -- ---------------------------------------------------------------- intel --
  v_j := public.ff_sunday(v_league, 3);
  v_i := v_j->'intel';
  if (v_i->>'can_tune')::boolean then raise exception 'Bo is not the commissioner'; end if;
  if (v_i->>'playoff_teams')::int <> 2 or (v_i->'rules'->>'rec_td')::int <> 6 then
    raise exception 'settings or rules missing: %', v_i;
  end if;

  v_t := (select x from jsonb_array_elements(v_i->'table') x where (x->>'team_id')::uuid = t_ada);
  if (v_t->>'rank')::int <> 1 or (v_t->>'wins')::int <> 2 or (v_t->>'streak')::int <> 2 then
    raise exception 'Ada should be 2-0, first, on two straight: %', v_t;
  end if;
  v_t := (select x from jsonb_array_elements(v_i->'table') x where (x->>'team_id')::uuid = t_cy);
  if (v_t->>'rank')::int <> 4 or (v_t->>'losses')::int <> 2 or (v_t->>'streak')::int <> -2 then
    raise exception 'Cy should be 0-2, last, two straight losses: %', v_t;
  end if;
  v_t := (select x from jsonb_array_elements(v_i->'table') x where (x->>'team_id')::uuid = t_bo);
  if (v_t->>'rank')::int <> 2 or (v_t->>'streak')::int <> 1 then
    raise exception 'Bo should be second on points for, one straight: %', v_t;
  end if;
  v_checks := v_checks + 4;

  if (v_i->'season_high'->>'points')::numeric <> 140 or (v_i->'season_high'->>'team_id')::uuid <> t_bo
     or (v_i->'season_high'->>'week')::int <> 2 then
    raise exception 'season high should be Bo''s 140 in week 2: %', v_i->'season_high';
  end if;
  v_checks := v_checks + 1;

  -- Ada v Cy: three imported meetings and this season's week 2. Ada has won
  -- the last three. This week's game is not in it.
  v_t := v_i->'h2h'->(v_m3a::text);
  if (v_t->>'meetings')::int <> 4 or (v_t->>'home_wins')::int <> 3 or (v_t->>'away_wins')::int <> 1
     or (v_t->>'streak')::int <> 3 or (v_t->>'since')::int <> 2029 then
    raise exception 'Ada v Cy series wrong: %', v_t;
  end if;
  -- Bo v Di met once, in week 2, Bo won.
  v_t := v_i->'h2h'->(v_m3b::text);
  if (v_t->>'meetings')::int <> 1 or (v_t->>'streak')::int <> 1 then
    raise exception 'Bo v Di series wrong: %', v_t;
  end if;
  v_checks := v_checks + 2;
  perform set_config('request.jwt.claims', '', true);

  -- -------------------------------------------------------------- moments --
  -- The detector's seeded state, written by hand: Cy leads Ada by 25.
  insert into sunday_matchup_state (matchup_id, league_id, leader, home_points, away_points)
  values (v_m3a, v_league, 'away', 10, 35), (v_m3b, v_league, 'home', 60, 50);
  v_n := public.ff_sunday_moments(v_league, 3);
  if v_n <> 0 then raise exception 'nothing had happened yet, but % moments were written', v_n; end if;

  -- Ada storms back and leads. Bo passes the season high of 140.
  update sunday_matchup_state set leader = 'home', home_points = 52, away_points = 40 where matchup_id = v_m3a;
  update sunday_matchup_state set home_points = 141.5 where matchup_id = v_m3b;
  v_n := public.ff_sunday_moments(v_league, 3);
  if v_n <> 2 then raise exception 'expected a comeback and a season high, got %', v_n; end if;

  select * into v_e from sunday_events where league_id = v_league and event_type = 'comeback';
  if v_e.level <> 4 or v_e.team_id <> t_ada or v_e.headline <> 'Ada comes back on Cy'
     or v_e.description <> 'Was down 25.0 and now leads' then
    raise exception 'comeback wrong: % / % / %', v_e.level, v_e.headline, v_e.description;
  end if;
  select * into v_e from sunday_events where league_id = v_league and event_type = 'season_high';
  if v_e.level <> 4 or v_e.team_id <> t_bo or v_e.description <> '141.5, past 140.0' then
    raise exception 'season high wrong: % / %', v_e.headline, v_e.description;
  end if;
  v_checks := v_checks + 3;

  -- The same look again tells nothing twice.
  v_n := public.ff_sunday_moments(v_league, 3);
  if v_n <> 0 then raise exception 'a second look wrote % moments again', v_n; end if;

  -- Ada past the record but not past Bo today: no record. Then past Bo: one.
  update sunday_matchup_state set home_points = 141 where matchup_id = v_m3a;
  v_n := public.ff_sunday_moments(v_league, 3);
  if v_n <> 0 then raise exception 'a record was set by somebody who is not top today'; end if;
  update sunday_matchup_state set home_points = 150 where matchup_id = v_m3a;
  v_n := public.ff_sunday_moments(v_league, 3);
  if v_n <> 1 or (select count(*) from sunday_events where league_id = v_league and event_type = 'season_high') <> 2 then
    raise exception 'Ada passing Bo''s new mark should be the second season high';
  end if;
  v_checks := v_checks + 3;

  -- Last place beats first: the final Cy won over Ada is raised to a moment.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, headline)
  values (v_league, v_season, 3, 'final:' || v_m3a, 'final', 1, 0, v_m3a, t_cy, t_ada, 'Cy beats Ada, 160.0–150.0');
  -- And an ordinary final that is not one: Di (third) over Bo (second).
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, headline)
  values (v_league, v_season, 3, 'final:' || v_m3b, 'final', 1, 0, v_m3b, t_di, t_bo, 'Di beats Bo');
  perform public.ff_sunday_moments(v_league, 3);
  select * into v_e from sunday_events where league_id = v_league and dedupe_key = 'final:' || v_m3a;
  if v_e.level <> 4 or v_e.description <> 'Last place beats first place' then
    raise exception 'last over first not raised: % / %', v_e.level, v_e.description;
  end if;
  if (select level from sunday_events where league_id = v_league and dedupe_key = 'final:' || v_m3b) <> 1 then
    raise exception 'an ordinary final was raised to a moment';
  end if;
  v_checks := v_checks + 2;

  -- The context line Talk shit posts for the new kinds.
  if public.ff_sunday_context((select id from sunday_events where league_id = v_league and event_type = 'comeback'))
       <> '🚨 Ada comes back on Cy — was down 25.0 and now leads.' then
    raise exception 'comeback context wrong: %',
      public.ff_sunday_context((select id from sunday_events where league_id = v_league and event_type = 'comeback'));
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------------- doors --
  if has_function_privilege('authenticated', 'public.ff_sunday_moments(uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ff_sunday_table(uuid,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ff_sunday_h2h(uuid,text,text,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.ff_set_sunday_weights(uuid,jsonb)', 'execute') then
    raise exception 'a service function is reachable from the browser';
  end if;
  v_checks := v_checks + 1;

  raise notice 'sunday intelligence: % checks passed', v_checks;
end $$;

rollback;
