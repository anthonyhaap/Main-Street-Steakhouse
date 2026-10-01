-- ============================================================================
-- The Fantasy RedZone event engine: says what happened, once.
--
-- `20261001120000_sunday_events` diffs the week against a snapshot every
-- minute and writes what changed. Its failure modes are the ones a feed is
-- judged by: posting the whole afternoon at once when it is switched on,
-- posting the same touchdown three times because Sleeper sent it three
-- times, telling one lead change twice, or losing one.
--
-- So this plays one invented fourth quarter through it, look by look:
--
--   first look            seeds silently
--   nothing changed       nothing
--   underdog scores a TD  one touchdown that carries the lead change (not two
--                         cards), an upset, and a close game
--   same look again       nothing
--   stat correction       the TD comes off; the lead goes back — a lead change
--   TD restored           no second touchdown, but the lead change it brings
--                         back IS told
--   red zone              one event per drive, never per poll
--   final                 once, as the upset it was
--
-- and then reads it back through ff_sunday as a member.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_uid uuid; v_home uuid; v_away uuid; v_m uuid; v_game uuid;
  v_qb uuid; v_rb uuid; v_wr uuid; v_te uuid;
  v_n integer; v_e sunday_events%rowtype; v_j jsonb;
  v_checks integer := 0;
  v_week constant integer := 5;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values ('SEA','Alphas','SEA'), ('SEB','Betas','SEB')
  on conflict (id) do nothing;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail)
  values ('se-1', 2026, 2, v_week, 'SEA', 'SEB', now() - interval '3 hours', 'in', '8:14 - 4th')
  returning id into v_game;

  insert into auth.users (email) values ('se@example.test') returning id into v_uid;
  insert into leagues (name, season, team_count, commissioner_id, roster_slots, settings)
  values ('Events Test', 2026, 2, v_uid, '["QB","RB","WR","TE"]'::jsonb, '{}'::jsonb)
  returning id into v_league;
  insert into league_scoring_rules (league_id, effective_from_week, rules)
  values (v_league, 1, '{"pass_yd":0.04,"pass_td":4,"rush_yd":0.1,"rush_td":6,
                         "rec":1,"rec_yd":0.1,"rec_td":6}'::jsonb);

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada Lovelace', v_uid)
  returning id into v_home;
  insert into teams (league_id, name, manager_name) values (v_league, 'Bravo', 'Bo') returning id into v_away;
  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, v_week, v_home, v_away)
  returning id into v_m;

  insert into players (full_name, position, nfl_team) values ('Home Quarterback','QB','SEA') returning id into v_qb;
  insert into players (full_name, position, nfl_team) values ('Home Runner','RB','SEA')      returning id into v_rb;
  insert into players (full_name, position, nfl_team) values ('Away Receiver','WR','SEB')    returning id into v_wr;
  insert into players (full_name, position, nfl_team) values ('Away End','TE','SEB')         returning id into v_te;
  insert into rosters (team_id, player_id, week, slot) values
    (v_home, v_qb, v_week, 'QB'), (v_home, v_rb, v_week, 'RB'),
    (v_away, v_wr, v_week, 'WR'), (v_away, v_te, v_week, 'TE');

  -- Ada came in the underdog by twenty: 20 projected against 40.
  insert into player_projections (player_id, season, season_type, week, stats, source) values
    (v_qb, 2026, 2, v_week, '{"pass_yd":250}', 'sleeper'),     -- 10
    (v_rb, 2026, 2, v_week, '{"rush_yd":100}', 'sleeper'),     -- 10
    (v_wr, 2026, 2, v_week, '{"rec":10,"rec_yd":100}', 'sleeper'), -- 20
    (v_te, 2026, 2, v_week, '{"rec":10,"rec_yd":100}', 'sleeper'); -- 20

  -- Ada 4.0 (QB 100 yards), Bo 13.0 (WR 3 for 40, TE 3 for 30). Bo leads by
  -- nine — wider than a close game, so the first look records it as open.
  insert into player_stat_lines (player_id, game_id, season, season_type, week, stats, source) values
    (v_qb, v_game, 2026, 2, v_week, '{"pass_yd":100}', 'sleeper'),
    (v_wr, v_game, 2026, 2, v_week, '{"rec":3,"rec_yd":40}', 'sleeper'),
    (v_te, v_game, 2026, 2, v_week, '{"rec":3,"rec_yd":30}', 'sleeper');

  -- A second table that has not kicked off, with an underdog on paper: no
  -- leader yet, but a projected one. Real weeks are full of these, and a
  -- leader of NULL compared against the underdog is NULL, not false — the
  -- every-minute update once wrote that NULL into a NOT NULL flag.
  insert into nfl_teams (id, name, espn_id) values ('SEC','Gammas','SEC'), ('SED','Deltas','SED')
  on conflict (id) do nothing;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail)
  values ('se-2', 2026, 2, v_week, 'SEC', 'SED', now() + interval '3 hours', 'pre', 'Sun 4:25 PM');
  declare v_c uuid; v_d uuid; v_cp uuid; v_dp uuid;
  begin
    insert into teams (league_id, name, manager_name) values (v_league, 'Charlie', 'Cy') returning id into v_c;
    insert into teams (league_id, name, manager_name) values (v_league, 'Delta', 'Di') returning id into v_d;
    insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, v_week, v_c, v_d);
    insert into players (full_name, position, nfl_team) values ('Later Runner','RB','SEC') returning id into v_cp;
    insert into players (full_name, position, nfl_team) values ('Later Receiver','WR','SED') returning id into v_dp;
    insert into rosters (team_id, player_id, week, slot) values (v_c, v_cp, v_week, 'RB'), (v_d, v_dp, v_week, 'WR');
    insert into player_projections (player_id, season, season_type, week, stats, source) values
      (v_cp, 2026, 2, v_week, '{"rush_yd":50}', 'sleeper'),        -- 5
      (v_dp, 2026, 2, v_week, '{"rec":10,"rec_yd":100}', 'sleeper'); -- 20: Cy is the underdog
  end;

  -- ------------------------------------------------------- the first look --
  v_n := public.ff_sunday_detect(v_league, v_week);
  if v_n <> 0 or exists (select 1 from sunday_events where league_id = v_league) then
    raise exception 'first look must seed silently, wrote %', v_n;
  end if;
  if (select leader from sunday_matchup_state where matchup_id = v_m) is distinct from 'away' then
    raise exception 'seed did not record Bo leading';
  end if;
  v_checks := v_checks + 2;

  v_n := public.ff_sunday_detect(v_league, v_week);
  if v_n <> 0 then raise exception 'nothing changed, but % events were written', v_n; end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------- the underdog scores --
  -- Home Runner: 60 yards and a touchdown, 12.0. Ada 16.0, Bo 13.0.
  insert into player_stat_lines (player_id, game_id, season, season_type, week, stats, source)
  values (v_rb, v_game, 2026, 2, v_week, '{"rush_yd":60,"rush_td":1}', 'sleeper');

  v_n := public.ff_sunday_detect(v_league, v_week);
  select * into v_e from sunday_events where league_id = v_league and event_type = 'touchdown';
  if not found then raise exception 'no touchdown event'; end if;
  if v_e.player_id <> v_rb or v_e.team_id <> v_home or v_e.points_added <> 12
     or v_e.old_score <> 4 or v_e.new_score <> 16 or v_e.opp_old_score <> 13 or v_e.opp_new_score <> 13 then
    raise exception 'touchdown impact wrong: % % % % % %', v_e.points_added, v_e.old_score, v_e.new_score,
      v_e.opp_old_score, v_e.opp_new_score, v_e.team_id = v_home;
  end if;
  if not v_e.lead_change or v_e.level <> 4 then
    raise exception 'a late go-ahead touchdown is a level-4 lead change, got lead=% level=%', v_e.lead_change, v_e.level;
  end if;
  if v_e.headline <> 'Home Runner — rushing touchdown' or v_e.description <> 'Ada takes the lead over Bo' then
    raise exception 'touchdown words wrong: % / %', v_e.headline, v_e.description;
  end if;
  -- Told once: the touchdown carries the lead change, so there is no second card.
  if exists (select 1 from sunday_events where league_id = v_league and event_type = 'lead_change') then
    raise exception 'the lead change was told twice';
  end if;
  if (select count(*) from sunday_events where league_id = v_league and event_type = 'upset_watch') <> 1 then
    raise exception 'the underdog leading is an upset watch';
  end if;
  if (select count(*) from sunday_events where league_id = v_league and event_type = 'close_game') <> 1 then
    raise exception 'three points late is a close game';
  end if;
  if v_n <> 3 then raise exception 'expected 3 events for the touchdown look, got %', v_n; end if;
  v_checks := v_checks + 6;

  -- Sleeper sends the same line again, and again.
  v_n := public.ff_sunday_detect(v_league, v_week) + public.ff_sunday_detect(v_league, v_week);
  if v_n <> 0 then raise exception 'the same touchdown was written again (% more)', v_n; end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------ stat correction --
  -- The touchdown comes off. Ada 10.0, Bo 13.0: the lead goes back.
  update player_stat_lines set stats = '{"rush_yd":60}' where player_id = v_rb;
  v_n := public.ff_sunday_detect(v_league, v_week);
  if v_n <> 1 or (select count(*) from sunday_events where league_id = v_league and event_type = 'lead_change'
                    and team_id = v_away and dedupe_key = format('lead:%s:2', v_m)) <> 1 then
    raise exception 'the correction handing Bo the lead back must be one lead change, got %', v_n;
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------- TD restored --
  update player_stat_lines set stats = '{"rush_yd":60,"rush_td":1}' where player_id = v_rb;
  v_n := public.ff_sunday_detect(v_league, v_week);
  if (select count(*) from sunday_events where league_id = v_league and event_type = 'touchdown') <> 1 then
    raise exception 'a restored touchdown was posted a second time';
  end if;
  if v_n <> 1 or not exists (select 1 from sunday_events where league_id = v_league
                             and dedupe_key = format('lead:%s:3', v_m) and team_id = v_home) then
    raise exception 'the lead change a restored touchdown brings back was lost (wrote %)', v_n;
  end if;
  v_checks := v_checks + 2;

  -- ---------------------------------------------------------- red zone --
  update nfl_games set red_zone = true, possession = 'SEA', down_distance = '1st & Goal at SEB 4' where id = v_game;
  v_n := public.ff_sunday_detect(v_league, v_week);
  select * into v_e from sunday_events where league_id = v_league and event_type = 'red_zone';
  if v_n <> 1 or v_e.headline <> 'In the red zone: Home Quarterback, Home Runner'
     or v_e.description <> 'SEA ball — 1st & Goal at SEB 4' then
    raise exception 'red zone event wrong: % / % (wrote %)', v_e.headline, v_e.description, v_n;
  end if;
  v_n := public.ff_sunday_detect(v_league, v_week);
  if v_n <> 0 then raise exception 'one drive, % red-zone events', v_n + 1; end if;
  update nfl_games set red_zone = false where id = v_game;
  perform public.ff_sunday_detect(v_league, v_week);
  update nfl_games set red_zone = true where id = v_game;
  v_n := public.ff_sunday_detect(v_league, v_week);
  if v_n <> 1 then raise exception 'a second drive is a second red-zone event, got %', v_n; end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------------- final --
  update nfl_games set status = 'post', status_detail = 'Final', red_zone = false, possession = null
   where id = v_game;
  v_n := public.ff_sunday_detect(v_league, v_week);
  select * into v_e from sunday_events where league_id = v_league and event_type = 'final';
  if v_n <> 1 or v_e.team_id <> v_home or v_e.level <> 3 or v_e.headline <> 'Ada beats Bo, 16.00–13.00' then
    raise exception 'final wrong: % level % (wrote %)', v_e.headline, v_e.level, v_n;
  end if;
  v_n := public.ff_sunday_detect(v_league, v_week);
  if v_n <> 0 then raise exception 'the final was written twice'; end if;
  v_checks := v_checks + 2;

  -- ----------------------------------------------------- read it back --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  v_j := public.ff_sunday(v_league, v_week);
  if jsonb_array_length(v_j->'events') <> (select count(*) from sunday_events where league_id = v_league)
     or v_j->'events'->0->>'type' <> 'final' then
    raise exception 'ff_sunday did not carry the events newest first';
  end if;
  if (select e->>'player_name' from jsonb_array_elements(v_j->'events') e where e->>'type' = 'touchdown')
     <> 'Home Runner' then
    raise exception 'an event did not carry the player it names';
  end if;
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 2;

  -- The engine's tables are the server's. A member reads events and nothing else.
  if has_table_privilege('authenticated', 'public.sunday_player_state', 'select')
     or has_table_privilege('authenticated', 'public.sunday_events', 'insert')
     or has_function_privilege('authenticated', 'public.ff_sunday_detect(uuid,integer)', 'execute') then
    raise exception 'the engine is reachable from the browser';
  end if;
  v_checks := v_checks + 1;

  -- Regenerating the schedule deletes the league's matchups. The history
  -- must survive it: every event stays, only its matchup link goes.
  v_n := (select count(*) from sunday_events where league_id = v_league);
  delete from matchups where id = v_m;
  if (select count(*) from sunday_events where league_id = v_league) <> v_n
     or exists (select 1 from sunday_events where league_id = v_league and matchup_id is not null) then
    raise exception 'deleting a matchup took its event history with it';
  end if;
  v_checks := v_checks + 1;

  raise notice 'sunday_events: % checks passed', v_checks;
end $$;

rollback;
