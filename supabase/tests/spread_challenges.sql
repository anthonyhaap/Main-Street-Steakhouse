-- ============================================================================
-- Against the spread.
--
-- Two managers who do not play each other in fantasy, one NFL game, a line.
-- The checks: ESPN's line is read onto the home side, the bet writes its own
-- terms, kickoff locks it both ways, the final decides it by the number and
-- not the winner, a push is void, and nothing about the line moves once
-- proposed.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p is null then '' else json_build_object('sub', p)::text end, true);
end $$;

do $$
declare
  v_league uuid := '11111111-1111-1111-1111-111111111111';
  v_uid_a uuid; v_uid_b uuid; v_uid_c uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_game uuid; v_game2 uuid; v_game3 uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid;
  v_row record;
  v_checks integer := 0;
begin
  -- ------------------------------------------------------- reading ESPN --
  if ff_espn_home_spread('{"competitors":[{"homeAway":"home","team":{"abbreviation":"KC"}},
                                          {"homeAway":"away","team":{"abbreviation":"BUF"}}],
                           "odds":[{"details":"KC -3.5"}]}'::jsonb) <> -3.5 then
    raise exception 'a home favourite was not read as a negative home spread';
  end if;
  if ff_espn_home_spread('{"competitors":[{"homeAway":"home","team":{"abbreviation":"KC"}},
                                          {"homeAway":"away","team":{"abbreviation":"WSH"}}],
                           "odds":[{"details":"WSH -7"}]}'::jsonb) <> 7 then
    raise exception 'an away favourite was not read as a positive home spread';
  end if;
  if ff_espn_home_spread('{"competitors":[],"odds":[{"details":"EVEN"}]}'::jsonb) <> 0 then
    raise exception 'a pick''em was not read as zero';
  end if;
  if ff_espn_home_spread('{"competitors":[{"homeAway":"home","team":{"abbreviation":"KC"}}]}'::jsonb) is not null
     or ff_espn_home_spread('{"odds":[{"details":"KC -3.5 o47"}]}'::jsonb) is not null then
    raise exception 'a missing or unreadable line was read as a number';
  end if;
  v_checks := v_checks + 4;

  if ff_spread_text('KC', -3.5) <> 'KC -3.5' or ff_spread_text('BUF', 3) <> 'BUF +3'
     or ff_spread_text('KC', 0) <> 'KC PK' then
    raise exception 'the line is written as %, %, %',
      ff_spread_text('KC', -3.5), ff_spread_text('BUF', 3), ff_spread_text('KC', 0);
  end if;
  v_checks := v_checks + 1;

  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values (gen_random_uuid(), 'ada@example.com') returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'bo@example.com')  returning id into v_uid_b;
  insert into auth.users (id, email) values (gen_random_uuid(), 'cy@example.com')  returning id into v_uid_c;

  insert into leagues (id, name, season, commissioner_id, roster_slots, settings)
  values (v_league, 'Spread Test', 2026, v_uid_a,
          '["QB","RB","WR","TE","FLEX","K","DEF"]'::jsonb, '{}'::jsonb);
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada Lovelace', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo Jackson', v_uid_b)   returning id into v_b;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Charlie', 'Cy Young', v_uid_c)   returning id into v_c;

  -- No fantasy matchup between anybody: a spread bet does not need one.
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status, home_spread)
  values ('ats-1', 2026, 2, 7, 'KC', 'BUF', now() + interval '2 days', 'pre', -3.0) returning id into v_game;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('ats-2', 2026, 2, 7, 'SEA', 'NE', now() + interval '2 days', 'pre') returning id into v_game2;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('ats-3', 2026, 2, 7, 'DAL', 'PHI', now() - interval '1 hour', 'in') returning id into v_game3;

  perform pg_temp.as_user(v_uid_a); perform ff_save_settlement_profile('Ada', 'venmo', 'ada-pays');
  perform pg_temp.as_user(v_uid_b); perform ff_save_settlement_profile('Bo',  'venmo', 'bo-pays');

  -- --------------------------------------------------------- the proposal --
  perform pg_temp.as_user(v_uid_a);
  v_c1 := ff_create_spread_challenge(v_league, v_uid_b, v_game, 'BUF', 3, 2000);
  select * into v_row from challenges where id = v_c1;
  if v_row.proposition_type <> 'nfl_spread' then raise exception 'filed as %', v_row.proposition_type; end if;
  if v_row.title <> 'BUF +3 at KC' then raise exception 'the title reads "%"', v_row.title; end if;
  if v_row.terms not like 'Ada takes BUF +3. Bo takes KC -3. Week 7,%' then raise exception 'the terms read "%"', v_row.terms; end if;
  if v_row.stake_label <> 'External settlement' then raise exception 'a stake was labelled %', v_row.stake_label; end if;
  v_checks := v_checks + 4;

  -- Bad shapes are refused.
  begin
    perform ff_create_spread_challenge(v_league, v_uid_b, v_game, 'SEA', 3, null);
    raise exception 'a team not in the game was bet on';
  exception when others then if sqlerrm not like '%not in this game%' then raise; end if; end;
  begin
    perform ff_create_spread_challenge(v_league, v_uid_b, v_game, 'KC', 2.25, null);
    raise exception 'a quarter-point line was accepted';
  exception when others then if sqlerrm not like '%half point%' then raise; end if; end;
  begin
    perform ff_create_spread_challenge(v_league, v_uid_b, v_game3, 'DAL', -1.5, null);
    raise exception 'a game already on was bet';
  exception when others then if sqlerrm not like '%kicked off%' then raise; end if; end;
  begin
    perform ff_create_spread_challenge(v_league, v_uid_a, v_game, 'KC', -3, null);
    raise exception 'a manager bet against themselves';
  exception when others then if sqlerrm not like '%another manager%' then raise; end if; end;
  v_checks := v_checks + 4;

  -- The line is the terms.
  perform pg_temp.as_user(null);
  begin
    update challenges set spread_line = 10 where id = v_c1;
    raise exception 'the line moved after proposal';
  exception when others then if sqlerrm not like '%cannot change%' then raise; end if; end;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ accepted --
  perform pg_temp.as_user(v_uid_b);
  perform ff_respond_challenge(v_c1, 'accepted');
  if (select status from challenges where id = v_c1) <> 'accepted' then raise exception 'the bet did not lock'; end if;
  v_checks := v_checks + 1;

  -- A second bet, bragging rights, on the same game from the other side.
  perform pg_temp.as_user(v_uid_c);
  v_c2 := ff_create_spread_challenge(v_league, v_uid_b, v_game, 'KC', -3, null);
  perform pg_temp.as_user(v_uid_b);
  perform ff_respond_challenge(v_c2, 'accepted');
  -- And one nobody answers.
  perform pg_temp.as_user(v_uid_c);
  v_c3 := ff_create_spread_challenge(v_league, v_uid_a, v_game2, 'NE', 6.5, null);

  -- --------------------------------------------------------- kickoff --
  perform pg_temp.as_user(null);
  if ff_resolve_spread_challenges() <> 0 then raise exception 'the resolver moved a bet before kickoff'; end if;
  update nfl_games set kickoff_at = now() - interval '5 minutes', status = 'in' where id in (v_game, v_game2);

  perform pg_temp.as_user(v_uid_a);
  begin
    perform ff_respond_challenge(v_c3, 'accepted');
    raise exception 'a spread bet was taken after kickoff';
  exception when others then if sqlerrm not like '%kicked off%' then raise; end if; end;
  v_checks := v_checks + 2;

  perform pg_temp.as_user(null);
  if ff_resolve_spread_challenges() <> 1 then raise exception 'the unanswered bet did not expire at kickoff'; end if;
  if (select status from challenges where id = v_c3) <> 'expired' then raise exception 'the unanswered bet is %', (select status from challenges where id = v_c3); end if;
  -- Scores on the board mid-game decide nothing.
  update nfl_games set home_score = 3, away_score = 17, status_detail = 'Q2 4:12' where id = v_game;
  if ff_resolve_spread_challenges() <> 0 then raise exception 'a game still on decided a bet'; end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------------ the final --
  -- KC wins by 7: covers -3. Bo (KC -3 against Ada) wins; Cy (KC -3 against Bo) wins.
  delete from notification_outbox;
  update nfl_games set status = 'post', status_detail = 'Final', home_score = 27, away_score = 20 where id = v_game;
  if ff_resolve_spread_challenges() <> 2 then raise exception 'the final did not decide both bets'; end if;

  select * into v_row from challenges where id = v_c1;
  if v_row.status <> 'resolved' or v_row.winner_id <> v_uid_b then
    raise exception 'BUF +3 losing by 7 went % to %', v_row.status, v_row.winner_id;
  end if;
  if v_row.resolution_evidence->>'source' <> 'nfl_final' or (v_row.resolution_evidence->>'home_score')::int <> 27 then
    raise exception 'the evidence reads %', v_row.resolution_evidence;
  end if;
  if v_row.settlement_due_at is null then raise exception 'no settlement grace on a stake'; end if;
  select * into v_row from challenges where id = v_c2;
  if v_row.status <> 'settled' or v_row.winner_id <> v_uid_c then
    raise exception 'KC -3 winning by 7 went % to %', v_row.status, v_row.winner_id;
  end if;
  v_checks := v_checks + 4;

  select * into v_row from notification_outbox where user_id = v_uid_a;
  if v_row.title <> 'You owe Bo $20' then raise exception 'the loser''s slip reads "%"', v_row.title; end if;
  if v_row.body <> 'BUF +3 at KC went Bo''s way. Tap to pay.' then raise exception 'the loser''s body reads "%"', v_row.body; end if;
  v_checks := v_checks + 2;

  if ff_resolve_spread_challenges() <> 0 then raise exception 'a decided bet was decided again'; end if;
  v_checks := v_checks + 1;

  -- -------------------------------------------------------------- a push --
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('ats-4', 2026, 2, 8, 'NYG', 'DAL', now() + interval '1 day', 'pre') returning id into v_game;
  perform pg_temp.as_user(v_uid_a);
  v_c4 := ff_create_spread_challenge(v_league, v_uid_b, v_game, 'DAL', -3, 500);
  perform pg_temp.as_user(v_uid_b);
  perform ff_respond_challenge(v_c4, 'accepted');
  perform pg_temp.as_user(null);
  update nfl_games set kickoff_at = now() - interval '4 hours', status = 'post', status_detail = 'Final/OT',
                       home_score = 20, away_score = 23 where id = v_game;
  if ff_resolve_spread_challenges() <> 1 then raise exception 'a push was not decided'; end if;
  select * into v_row from challenges where id = v_c4;
  if v_row.status <> 'voided' or v_row.winner_id is not null or v_row.settlement_due_at is not null then
    raise exception 'landing on the number went % to %', v_row.status, v_row.winner_id;
  end if;
  v_checks := v_checks + 2;

  -- --------------------------------------------------------- who may call --
  if has_function_privilege('authenticated', 'public.ff_resolve_spread_challenges()', 'execute') then
    raise exception 'a manager can run the spread resolver';
  end if;
  if not has_function_privilege('authenticated', 'public.ff_create_spread_challenge(uuid,uuid,uuid,text,numeric,integer)', 'execute') then
    raise exception 'a manager cannot propose a spread bet';
  end if;
  if has_function_privilege('anon', 'public.ff_create_spread_challenge(uuid,uuid,uuid,text,numeric,integer)', 'execute') then
    raise exception 'anyone at all can propose a spread bet';
  end if;
  v_checks := v_checks + 3;

  raise notice 'spread challenges: % checks passed', v_checks;
end $$;

rollback;
