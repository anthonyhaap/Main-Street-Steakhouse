-- ============================================================================
-- Steakhouse Sunday, phase 5: the day is kept.
--
-- `20261002000000_sunday_history` reads the persisted Sunday back two ways:
-- one week's recap extras, and the whole league's Sunday history. The ways a
-- reading goes wrong are the ones checked here — a chat line from another
-- week crowned the week's best, a declined bet listed as a result, a
-- comeback that never held called one, a comeback counted again as a lead
-- change, another league's moment on this wall, a stranger reading any of it.
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
  v_league uuid; v_other uuid;
  v_ada uuid; v_bo uuid; v_cy uuid; v_x uuid;
  t_ada uuid; t_bo uuid; t_o1 uuid; t_o2 uuid;
  v_m uuid; v_mo uuid;
  v_comeback uuid; v_rz uuid; v_td uuid; v_lc uuid;
  v_best uuid; v_kick timestamptz := now() - interval '3 days';
  v_j jsonb; v_t jsonb;
  v_checks integer := 0;
  v_failed boolean;
  v_season constant integer := 2032;
begin
  insert into nfl_teams (id, name, espn_id) values ('SHA','Alphas','SHA'), ('SHB','Betas','SHB')
  on conflict (id) do nothing;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status, status_detail)
  values ('sh-1', v_season, 2, 1, 'SHA', 'SHB', v_kick, 'post', 'Final');

  insert into auth.users (email) values ('sh-ada@example.test') returning id into v_ada;
  insert into auth.users (email) values ('sh-bo@example.test')  returning id into v_bo;
  insert into auth.users (email) values ('sh-cy@example.test')  returning id into v_cy;
  insert into auth.users (email) values ('sh-x@example.test')   returning id into v_x;

  insert into leagues (name, season, team_count, commissioner_id, roster_slots, settings)
  values ('History Test', v_season, 2, v_ada, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, team_count, commissioner_id, roster_slots, settings)
  values ('Elsewhere', v_season, 2, v_x, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada', v_ada) returning id into t_ada;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_bo)   returning id into t_bo;
  insert into teams (league_id, name, manager_name, owner_id) values (v_other, 'Other1', 'X', v_x)     returning id into t_o1;
  insert into teams (league_id, name, manager_name) values (v_other, 'Other2', 'Y')                     returning id into t_o2;

  -- Week 1: Ada was down 22 and won by one, after three lead changes.
  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points)
  values (v_league, 1, t_ada, t_bo, 101, 100) returning id into v_m;
  insert into sunday_matchup_state (matchup_id, league_id, leader, lead_changes, home_points, away_points, home_worst, away_worst)
  values (v_m, v_league, 'home', 3, 101, 100, 22, 5);

  -- Elsewhere: a bigger comeback and a bigger play that must not reach this wall.
  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points)
  values (v_other, 1, t_o1, t_o2, 150, 90) returning id into v_mo;
  insert into sunday_matchup_state (matchup_id, league_id, leader, lead_changes, home_points, away_points, home_worst, away_worst)
  values (v_mo, v_other, 'home', 9, 150, 90, 60, 0);
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, matchup_id, team_id, points_added, headline, detail)
  values (v_other, v_season, 1, 'td:o', 'touchdown', 4, v_mo, t_o1, 40, 'Somebody else — 99 yards', '{"who":"X"}');

  -- The day's events in this league.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority, matchup_id, team_id, opponent_team_id,
                             lead_change, headline, description, detail)
  values (v_league, v_season, 1, 'comeback:1', 'comeback', 4, 65, v_m, t_ada, t_bo, true,
          'Ada comes back on Bo', 'Was down 22.0 and now leads', '{"who":"Ada","opp":"Bo"}')
  returning id into v_comeback;
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority, matchup_id, team_id, opponent_team_id,
                             lead_change, headline, detail)
  values (v_league, v_season, 1, 'lead:1', 'lead_change', 3, 35, v_m, t_ada, t_bo, true, 'Ada takes the lead over Bo', '{"who":"Ada"}')
  returning id into v_lc;
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority, matchup_id, team_id,
                             points_added, headline, detail)
  values (v_league, v_season, 1, 'td:1', 'touchdown', 3, 20, v_m, t_bo, 12.5, 'Bo''s back — 40+ yard touchdown', '{"who":"Bo"}')
  returning id into v_td;
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority, matchup_id, team_id, headline)
  values (v_league, v_season, 1, 'rz:1', 'red_zone', 2, 10, v_m, t_bo, 'In the red zone: somebody')
  returning id into v_rz;
  -- The room loved the red-zone card more than anything.
  insert into reactions (league_id, source, target_id, user_id, emoji) values
    (v_league, 'sunday', v_rz, v_ada, '😂'), (v_league, 'sunday', v_rz, v_bo, '😂'), (v_league, 'sunday', v_rz, v_cy, '🔥'),
    (v_league, 'sunday', v_comeback, v_bo, '😡');

  -- Challenges on the matchup: one settled, one declined.
  insert into challenges (league_id, challenger_id, opponent_id, title, terms, matchup_id, status, winner_id, resolved_at)
  values (v_league, v_bo, v_ada, 'Bo beats Ada', 'Higher score wins.', v_m, 'resolved', v_ada, now());
  insert into challenges (league_id, challenger_id, opponent_id, title, terms, matchup_id, status)
  values (v_league, v_ada, v_bo, 'Ada by twenty', 'Margin of 20.', v_m, 'declined');

  -- Chat: the week's best line has two reactions; a louder one is from a
  -- different week and must not count.
  insert into league_messages (league_id, author_id, body, created_at)
  values (v_league, v_bo, 'how did I lose that', v_kick + interval '4 hours') returning id into v_best;
  insert into reactions (league_id, source, target_id, user_id, emoji) values
    (v_league, 'message', v_best, v_ada, '💀'), (v_league, 'message', v_best, v_cy, '😂');
  with m as (insert into league_messages (league_id, author_id, body, created_at)
             values (v_league, v_ada, 'preseason trash talk', v_kick - interval '20 days') returning id)
  insert into reactions (league_id, source, target_id, user_id, emoji)
  select v_league, 'message', m.id, u, '🔥' from m, unnest(array[v_bo, v_cy, v_x]) u;

  -- ---------------------------------------------------------------- recap --
  perform set_config('request.jwt.claims', json_build_object('sub', v_bo)::text, true);
  v_j := public.ff_sunday_recap(v_league, 1);

  v_t := v_j->'swings'->0;
  if jsonb_array_length(v_j->'swings') <> 1 or (v_t->>'lead_changes')::int <> 3 or (v_t->>'home_worst')::numeric <> 22 then
    raise exception 'swings wrong: %', v_j->'swings';
  end if;
  if jsonb_array_length(v_j->'challenges') <> 1 or v_j->'challenges'->0->>'winner' <> 'Ada'
     or v_j->'challenges'->0->>'who' <> 'Bo' then
    raise exception 'challenges wrong (the declined one is not a result): %', v_j->'challenges';
  end if;
  if (v_j->'best_chat'->>'id')::uuid <> v_best or (v_j->'best_chat'->>'reactions')::int <> 2 then
    raise exception 'best chat should be the week''s own two-reaction line: %', v_j->'best_chat';
  end if;
  v_checks := v_checks + 3;

  -- -------------------------------------------------------------- history --
  v_j := public.ff_sunday_history(v_league);

  if jsonb_array_length(v_j->'moments') <> 2
     or (v_j->'moments'->0->>'id')::uuid <> v_rz or (v_j->'moments'->1->>'id')::uuid <> v_comeback then
    raise exception 'moments should be the red zone (3 reactions) then the comeback: %', v_j->'moments';
  end if;
  if (v_j->'moments'->0->>'reactions')::int <> 3 then raise exception 'moment reactions wrong'; end if;
  v_checks := v_checks + 2;

  v_t := v_j->'records';
  if (v_t->'comeback'->>'down')::numeric <> 22 or v_t->'comeback'->>'who' <> 'Ada' or v_t->'comeback'->>'opp' <> 'Bo' then
    raise exception 'comeback record wrong (another league''s 60 must not count): %', v_t->'comeback';
  end if;
  if (v_t->'lead_changes'->>'n')::int <> 3 then raise exception 'lead change record wrong: %', v_t->'lead_changes'; end if;
  if (v_t->'closest'->>'margin')::numeric <> 1 then raise exception 'closest wrong: %', v_t->'closest'; end if;
  if (v_t->'play'->>'points')::numeric <> 12.5 or v_t->'play'->>'who' <> 'Bo' then
    raise exception 'biggest play wrong: %', v_t->'play';
  end if;
  v_checks := v_checks + 4;

  v_t := (select x from jsonb_array_elements(v_j->'managers') x where (x->>'team_id')::uuid = t_ada);
  -- The comeback carries lead_change = true, but it is the same flip as the
  -- lead-change row: one lead change, not two.
  if (v_t->>'moments')::int <> 1 or (v_t->>'comebacks')::int <> 1 or (v_t->>'lead_changes')::int <> 1
     or (v_t->>'reactions')::int <> 1 then
    raise exception 'Ada''s Sunday line wrong: %', v_t;
  end if;
  v_t := (select x from jsonb_array_elements(v_j->'managers') x where (x->>'team_id')::uuid = t_bo);
  if (v_t->>'touchdowns')::int <> 1 or (v_t->>'reactions')::int <> 3 or (v_t->>'moments')::int <> 0 then
    raise exception 'Bo''s Sunday line wrong: %', v_t;
  end if;
  if jsonb_array_length(v_j->'managers') <> 2 or (v_j->>'weeks')::int <> 1 then
    raise exception 'managers or weeks wrong: %', v_j;
  end if;
  v_checks := v_checks + 3;

  -- ---------------------------------------------------------------- doors --
  perform set_config('request.jwt.claims', json_build_object('sub', v_x)::text, true);
  v_failed := false;
  begin perform public.ff_sunday_history(v_league);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a stranger read the league''s Sunday history'; end if;
  v_failed := false;
  begin perform public.ff_sunday_recap(v_league, 1);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a stranger read the league''s recap'; end if;
  perform set_config('request.jwt.claims', '', true);
  if has_function_privilege('anon', 'public.ff_sunday_history(uuid)', 'execute')
     or has_function_privilege('anon', 'public.ff_sunday_recap(uuid,integer)', 'execute') then
    raise exception 'history is reachable without signing in';
  end if;
  v_checks := v_checks + 3;

  raise notice 'sunday history: % checks passed', v_checks;
end $$;

rollback;
