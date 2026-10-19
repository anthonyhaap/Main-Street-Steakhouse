-- ============================================================================
-- Game day on the lock screen: who is buzzed about what, and who is not.
--
-- `20261002160000_gameday_push` turns sunday_events into pushes for the two
-- managers at the table. As with every push test here, most of the checks are
-- restraint: the third manager is not told about somebody else's lead change,
-- a squeeze a minute after a lead change waits, an ordinary touchdown is
-- silent, the league's moments are off until asked for, and a switched-off
-- kind stays off — for that manager only, not for his co-owner.
--
-- Season 2033, so nothing else in the replay's slate can make a week final.
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  u_ada uuid; u_bo uuid; u_cy uuid; u_di uuid; u_eve uuid;
  t_ada uuid; t_bo uuid; t_cy uuid; t_di uuid;
  v_m uuid; v_m2 uuid;
  v_star uuid;
  v_o notification_outbox%rowtype;
  v_n integer;
  v_j jsonb;
  v_checks integer := 0;
  v_season constant integer := 2033;

  -- Insert one event as the detector would.
  ev text := 'insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, matchup_id,
               team_id, opponent_team_id, player_id, points_added, old_score, new_score, opp_old_score, opp_new_score,
               lead_change, headline, description, detail) values ';
begin
  insert into auth.users (email) values ('gp-ada@example.test') returning id into u_ada;
  insert into auth.users (email) values ('gp-bo@example.test')  returning id into u_bo;
  insert into auth.users (email) values ('gp-cy@example.test')  returning id into u_cy;
  insert into auth.users (email) values ('gp-di@example.test')  returning id into u_di;
  insert into auth.users (email) values ('gp-eve@example.test') returning id into u_eve;

  insert into leagues (name, season, team_count, commissioner_id, roster_slots)
  values ('Push Day', v_season, 4, u_ada, '["WR"]'::jsonb) returning id into v_league;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada', u_ada) returning id into t_ada;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', u_bo)   returning id into t_bo;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Charlie', 'Cy', u_cy) returning id into t_cy;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Delta', 'Di', u_di)   returning id into t_di;
  -- Eve co-owns Alpha with Ada.
  insert into team_co_owners (team_id, user_id, league_id) values (t_ada, u_eve, v_league);

  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, 4, t_ada, t_bo) returning id into v_m;
  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, 4, t_cy, t_di) returning id into v_m2;
  insert into players (full_name, position, nfl_team) values ('Push Star', 'WR', null) returning id into v_star;

  -- Everybody has a phone except Di.
  insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
    (u_ada, 'https://push.test/ada', 'k', 'a'), (u_bo, 'https://push.test/bo', 'k', 'a'),
    (u_cy, 'https://push.test/cy', 'k', 'a'), (u_eve, 'https://push.test/eve', 'k', 'a');

  -- ------------------------------------------------------------ defaults --
  perform set_config('request.jwt.claims', json_build_object('sub', u_ada)::text, true);
  v_j := public.ff_notification_prefs();
  if not (v_j->>'gameday')::boolean or (v_j->>'moments')::boolean then
    raise exception 'game day should default on and moments off: %', v_j;
  end if;
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 1;

  -- -------------------------------------------------- a touchdown takes it --
  -- Bo's receiver scores and Bo passes Ada. Both managers at the table hear it,
  -- each from their own side, and so does Ada's co-owner. Cy does not.
  execute ev || format('(%L,%s,4,''td:1'',''touchdown'',2,%L,%L,%L,%L,6.8,104.0,110.8,109.0,109.0,true,''Push Star — receiving touchdown'',''Bo takes the lead over Ada'',''{"who":"Bo","opp":"Ada"}'')',
    v_league, v_season, v_m, t_bo, t_ada, v_star);

  select * into v_o from notification_outbox where user_id = u_bo and kind = 'gameday';
  if v_o.title <> 'You take the lead over Ada' or v_o.body <> 'You 110.8, Ada 109.0. Push Star +6.8.'
     or v_o.url <> format('/matchups/%s?week=4', v_m) then
    raise exception 'Bo''s push wrong: % / % / %', v_o.title, v_o.body, v_o.url;
  end if;
  select * into v_o from notification_outbox where user_id = u_ada and kind = 'gameday';
  if v_o.title <> 'Bo takes the lead' or v_o.body <> 'Bo 110.8, you 109.0. Push Star +6.8.' then
    raise exception 'Ada''s push wrong: % / %', v_o.title, v_o.body;
  end if;
  if not exists (select 1 from notification_outbox where user_id = u_eve and kind = 'gameday' and title = 'Bo takes the lead') then
    raise exception 'Ada''s co-owner was not told';
  end if;
  if exists (select 1 from notification_outbox where user_id = u_cy) then
    raise exception 'Cy was pushed about somebody else''s game';
  end if;
  v_checks := v_checks + 4;

  -- ------------------------------------------------------ one buzz is right --
  -- A minute later Ada cuts it close and Bo's man has a monster game: both
  -- can wait, and do. The comeback behind a lead change waits too.
  execute ev || format('(%L,%s,4,''tight:1'',''tightening'',3,%L,%L,%L,null,null,null,108.0,null,110.8,false,''Ada cuts Bo''''s lead to 2.8'',''Was down 18.0'',''{"who":"Ada","opp":"Bo"}'')',
    v_league, v_season, v_m, t_ada, t_bo);
  execute ev || format('(%L,%s,4,''monster:1'',''monster_game'',3,%L,%L,%L,%L,null,null,110.8,null,108.0,false,''Push Star — monster game'',''31.0 points for Bo'',''{"who":"Bo","opp":"Ada","points":31}'')',
    v_league, v_season, v_m, t_bo, t_ada, v_star);
  select count(*) into v_n from notification_outbox where kind = 'gameday';
  if v_n <> 3 then raise exception 'non-urgent pushes inside two minutes should wait: % gameday rows', v_n; end if;
  v_checks := v_checks + 1;

  -- Two minutes on, the same squeeze would go out — and reads from both sides.
  update notification_outbox set created_at = created_at - interval '5 minutes';
  execute ev || format('(%L,%s,4,''tight:2'',''tightening'',3,%L,%L,%L,null,null,null,108.0,null,110.8,false,''Ada cuts Bo''''s lead to 2.8'',''Was down 18.0'',''{"who":"Ada","opp":"Bo"}'')',
    v_league, v_season, v_m, t_ada, t_bo);
  select * into v_o from notification_outbox where user_id = u_ada and kind = 'gameday' order by created_at desc limit 1;
  if v_o.title <> 'You''re within 2.8 of Bo' or v_o.body <> 'Was down 18.0. You 108.0, Bo 110.8.' then
    raise exception 'Ada''s squeeze wrong: % / %', v_o.title, v_o.body;
  end if;
  select * into v_o from notification_outbox where user_id = u_bo and kind = 'gameday' order by created_at desc limit 1;
  if v_o.title <> 'Ada is closing in' or v_o.body <> 'Your lead is down to 2.8 — Ada was down 18.0.' then
    raise exception 'Bo''s squeeze wrong: % / %', v_o.title, v_o.body;
  end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------------------- silence, mostly --
  -- An ordinary touchdown that changes nothing is not a push.
  update notification_outbox set created_at = created_at - interval '5 minutes';
  select count(*) into v_n from notification_outbox;
  execute ev || format('(%L,%s,4,''td:2'',''touchdown'',2,%L,%L,%L,%L,6.0,110.8,116.8,108.0,108.0,false,''Push Star — receiving touchdown'',null,''{"who":"Bo","opp":"Ada"}'')',
    v_league, v_season, v_m, t_bo, t_ada, v_star);
  if (select count(*) from notification_outbox) <> v_n then raise exception 'an ordinary touchdown buzzed somebody'; end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the moments --
  -- Inside a point at the whistle in Cy v Di: a level-4 moment. Nobody asked
  -- for moments, so nobody hears — Cy and Di are told their own final as
  -- game day, and Di has no phone.
  execute ev || format('(%L,%s,4,''final:2'',''final'',4,%L,%L,%L,null,null,null,101.4,null,100.9,false,''Cy beats Di, 101.4–100.9'',''Decided by less than a point'',''{}'')',
    v_league, v_season, v_m2, t_cy, t_di);
  if exists (select 1 from notification_outbox where kind = 'moment') then
    raise exception 'a moment went to somebody who never asked for them';
  end if;
  select * into v_o from notification_outbox where user_id = u_cy and kind = 'gameday';
  if v_o.title <> 'Final: you beat Di' or v_o.body <> '101.4–100.9. Decided by less than a point.' then
    raise exception 'Cy''s final wrong: % / %', v_o.title, v_o.body;
  end if;
  v_checks := v_checks + 2;

  -- Ada asks for them; the next one reaches her, the one after waits ten minutes.
  perform set_config('request.jwt.claims', json_build_object('sub', u_ada)::text, true);
  perform public.ff_set_notification_prefs(true, true, null, null, null, null, null, true);
  perform set_config('request.jwt.claims', '', true);
  execute ev || format('(%L,%s,4,''lead:9'',''lead_change'',4,%L,%L,%L,null,null,null,99.0,null,98.0,true,''Di takes the lead over Cy'',''Late, with 1 still to play'',''{"who":"Di","opp":"Cy"}'')',
    v_league, v_season, v_m2, t_di, t_cy);
  execute ev || format('(%L,%s,4,''lead:10'',''lead_change'',4,%L,%L,%L,null,null,null,99.5,null,99.0,true,''Cy takes the lead over Di'',''Late, with 1 still to play'',''{"who":"Cy","opp":"Di"}'')',
    v_league, v_season, v_m2, t_cy, t_di);
  if (select count(*) from notification_outbox where kind = 'moment' and user_id = u_ada) <> 1
     or exists (select 1 from notification_outbox where kind = 'moment' and user_id <> u_ada) then
    raise exception 'moments should reach Ada once and nobody else';
  end if;
  if (select title from notification_outbox where kind = 'moment') <> '🚨 Di takes the lead over Cy' then
    raise exception 'moment title wrong: %', (select title from notification_outbox where kind = 'moment');
  end if;
  v_checks := v_checks + 2;

  -- ----------------------------------------------------------- switched off --
  -- Ada turns game day off. Her co-owner still hears; she does not.
  perform set_config('request.jwt.claims', json_build_object('sub', u_ada)::text, true);
  perform public.ff_set_notification_prefs(true, true, null, null, null, null, false, null);
  perform set_config('request.jwt.claims', '', true);
  delete from notification_outbox;
  execute ev || format('(%L,%s,4,''lead:11'',''lead_change'',3,%L,%L,%L,null,null,null,112.0,null,110.8,true,''Ada takes the lead over Bo'',null,''{"who":"Ada","opp":"Bo"}'')',
    v_league, v_season, v_m, t_ada, t_bo);
  if exists (select 1 from notification_outbox where user_id = u_ada) then raise exception 'Ada switched game day off and was pushed'; end if;
  if not exists (select 1 from notification_outbox where user_id = u_eve and title = 'You take the lead over Bo') then
    raise exception 'Ada''s switch muted her co-owner';
  end if;
  if not exists (select 1 from notification_outbox where user_id = u_bo and title = 'Ada takes the lead') then
    raise exception 'Bo was not told he lost the lead';
  end if;
  v_checks := v_checks + 3;

  -- -------------------------------------------------- the detector is safe --
  -- An event pointing at a matchup that no longer exists still inserts.
  execute ev || format('(%L,%s,4,''lead:12'',''lead_change'',3,null,%L,%L,null,null,null,1,null,0,true,''Orphan'',null,''{}'')',
    v_league, v_season, t_ada, t_bo);
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------------- doors --
  if has_function_privilege('authenticated', 'public.ff_team_users(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ff_gameday_words(public.sunday_events,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ff_notify(uuid,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.ff_set_notification_prefs(boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean)', 'execute') then
    raise exception 'grants wrong on the game-day push functions';
  end if;
  v_checks := v_checks + 1;

  raise notice 'gameday push: % checks passed', v_checks;
end $$;

rollback;
