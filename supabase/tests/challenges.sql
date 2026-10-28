-- ============================================================================
-- A bet, from the shot to the slip.
--
-- Two managers, one matchup, twenty dollars. The checks follow the money: who
-- is told at each step and who is not, that the cron decides the bet when the
-- week is over and not before, that an unscored week is not a tie, and that
-- the reminder fires once. The settlement RPCs are exercised as the managers
-- meet them, through real JWT claims, because "only the loser can mark this
-- paid" is a claim about auth.uid() and nothing else.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

-- Sign in as a manager, or as nobody: the cron and the tests' own bookkeeping.
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p is null then '' else json_build_object('sub', p)::text end, true);
end $$;

do $$
declare
  -- ff_create_challenge refuses any league but the one the app is built for.
  v_league uuid := '11111111-1111-1111-1111-111111111111';
  v_uid_a uuid; v_uid_b uuid; v_uid_co uuid;
  v_a uuid; v_b uuid;
  v_m1 uuid; v_m2 uuid;
  v_game uuid;
  v_c1 uuid; v_c2 uuid;
  v_row record; v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values (gen_random_uuid(), 'ada@example.com') returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'bo@example.com')  returning id into v_uid_b;

  insert into leagues (id, name, season, commissioner_id, roster_slots, settings)
  values (v_league, 'Bet Test', 2026, v_uid_a,
          '["QB","RB","WR","TE","FLEX","K","DEF"]'::jsonb, '{}'::jsonb);

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada Lovelace', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo Jackson', v_uid_b)   returning id into v_b;

  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, 7, v_a, v_b) returning id into v_m1;
  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, 8, v_b, v_a) returning id into v_m2;

  -- Week 7 has a game still to be played.
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('bet-w7', 2026, 2, 7, 'SEA', 'NE', now() + interval '3 days', 'pre') returning id into v_game;

  -- Both can be reached.
  perform pg_temp.as_user(v_uid_a); perform ff_save_push_subscription('https://push.example/ada', 'k', 'a', 'Safari');
  perform pg_temp.as_user(v_uid_b); perform ff_save_push_subscription('https://push.example/bo',  'k', 'a', 'Chrome');

  -- ------------------------------------------- a stake needs two handles --
  perform pg_temp.as_user(v_uid_a);
  v_c1 := ff_create_challenge(v_league, v_uid_b, 'Higher Week 7 score', 'Winner has the higher final score.',
                              'External settlement', 'weekly_matchup_winner', 2000, v_m1);

  select * into v_row from notification_outbox;
  if v_row.user_id <> v_uid_b then raise exception 'the shot was announced to the wrong manager'; end if;
  if v_row.kind <> 'challenge' then raise exception 'the shot was filed as %', v_row.kind; end if;
  if v_row.title <> 'Ada challenged you' then raise exception 'the shot reads "%"', v_row.title; end if;
  if v_row.body <> '$20 on Week 7. Tap to accept or decline.' then raise exception 'the shot''s body reads "%"', v_row.body; end if;
  if v_row.url <> '/challenges#' || v_c1 then raise exception 'the shot points at %', v_row.url; end if;
  if exists (select 1 from notification_outbox where user_id = v_uid_a) then
    raise exception 'the challenger was told about his own shot';
  end if;
  v_checks := v_checks + 6;

  perform pg_temp.as_user(v_uid_b);
  begin
    perform ff_respond_challenge(v_c1, 'accepted');
    raise exception 'a stake was accepted before either side saved a handle';
  exception when others then
    if sqlerrm not like '%settlement handle%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  perform pg_temp.as_user(v_uid_a); perform ff_save_settlement_profile('Ada', 'venmo', '@ada-pays');
  perform pg_temp.as_user(v_uid_b); perform ff_save_settlement_profile('Bo',  'venmo', 'bo-pays');
  if (select settlement_handle from profiles where id = v_uid_a) <> 'ada-pays' then
    raise exception 'the leading @ was kept on the handle';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ accepted --
  delete from notification_outbox;
  perform pg_temp.as_user(v_uid_b);
  perform ff_respond_challenge(v_c1, 'accepted');

  select * into v_row from notification_outbox;
  if v_row.user_id <> v_uid_a then raise exception 'acceptance told the wrong manager'; end if;
  if v_row.title <> 'Bo accepted' then raise exception 'acceptance reads "%"', v_row.title; end if;
  if v_row.body <> 'It''s locked: Week 7 for $20.' then raise exception 'acceptance body reads "%"', v_row.body; end if;
  if (select count(*) from notification_outbox) <> 1 then raise exception 'acceptance produced more than one message'; end if;
  v_checks := v_checks + 4;

  -- ------------------------------------------ the week decides, not the cron --
  perform pg_temp.as_user(null);
  delete from notification_outbox;

  -- Nothing scored and the game not played: not a result, and not a tie.
  if ff_resolve_matchup_challenges() <> 0 then raise exception 'an unplayed week decided a bet'; end if;
  if (select status from challenges where id = v_c1) <> 'accepted' then raise exception 'an unscored 0-0 voided a bet'; end if;
  v_checks := v_checks + 2;

  -- Scored, but the week is still on: the standings would not call it, so
  -- neither does the bet.
  update matchups set home_points = 101.4, away_points = 88.9 where id = v_m1;
  if ff_resolve_matchup_challenges() <> 0 then raise exception 'a bet was decided while the week was still on'; end if;
  v_checks := v_checks + 1;

  -- The week ends.
  update nfl_games set status = 'post', kickoff_at = now() - interval '14 hours' where id = v_game;
  if ff_resolve_matchup_challenges() <> 1 then raise exception 'a finished, scored week did not decide the bet'; end if;
  select * into v_row from challenges where id = v_c1;
  if v_row.status <> 'resolved' then raise exception 'a bet with money on it went to % rather than resolved', v_row.status; end if;
  if v_row.winner_id <> v_uid_a then raise exception 'the wrong side won'; end if;
  if v_row.settlement_due_at is null or v_row.settlement_due_at < now() + interval '6 days' then
    raise exception 'the settlement grace was not set';
  end if;
  v_checks := v_checks + 4;

  -- The loser is told what is owed and the winner what is coming.
  if (select count(*) from notification_outbox) <> 2 then
    raise exception 'deciding the bet wrote % messages, expected 2', (select count(*) from notification_outbox);
  end if;
  select * into v_row from notification_outbox where user_id = v_uid_b;
  if v_row.title <> 'You owe Ada $20' then raise exception 'the loser''s slip reads "%"', v_row.title; end if;
  if v_row.body <> 'Week 7 went Ada''s way. Tap to pay.' then raise exception 'the loser''s body reads "%"', v_row.body; end if;
  select * into v_row from notification_outbox where user_id = v_uid_a;
  if v_row.title <> 'Bo owes you $20' then raise exception 'the winner''s slip reads "%"', v_row.title; end if;
  v_checks := v_checks + 4;

  -- Running the cron again does nothing more.
  delete from notification_outbox;
  if ff_resolve_matchup_challenges() <> 0 then raise exception 'a decided bet was decided again'; end if;
  if exists (select 1 from notification_outbox) then raise exception 'a second run repeated the slips'; end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------------------------ overdue --
  if ff_remind_overdue_challenges() <> 0 then raise exception 'a bet inside its grace was chased'; end if;
  update challenges set settlement_due_at = now() - interval '1 day' where id = v_c1;
  if ff_remind_overdue_challenges() <> 1 then raise exception 'an overdue bet was not chased'; end if;
  select * into v_row from notification_outbox;
  if v_row.user_id <> v_uid_b then raise exception 'the reminder went to the wrong side'; end if;
  if v_row.title <> 'Still owed: $20 to Ada' then raise exception 'the reminder reads "%"', v_row.title; end if;
  if ff_remind_overdue_challenges() <> 0 then raise exception 'the reminder fired twice'; end if;
  v_checks := v_checks + 5;

  -- ------------------------------------------------------- paid, confirmed --
  delete from notification_outbox;
  perform pg_temp.as_user(v_uid_a);
  begin
    perform ff_mark_challenge_paid(v_c1, 'x');
    raise exception 'the winner marked his own winnings paid';
  exception when others then
    if sqlerrm not like '%losing manager%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  perform pg_temp.as_user(v_uid_b);
  perform ff_mark_challenge_paid(v_c1, 'Venmo note: Week 7');
  select * into v_row from notification_outbox;
  if v_row.user_id <> v_uid_a then raise exception 'marking paid told the wrong manager'; end if;
  if v_row.title <> 'Bo marked $20 paid' then raise exception 'marking paid reads "%"', v_row.title; end if;
  v_checks := v_checks + 2;

  delete from notification_outbox;
  perform pg_temp.as_user(v_uid_a);
  perform ff_confirm_challenge_received(v_c1);
  select * into v_row from notification_outbox;
  if v_row.user_id <> v_uid_b then raise exception 'confirmation told the wrong manager'; end if;
  if v_row.title <> 'Ada confirmed. Settled.' then raise exception 'confirmation reads "%"', v_row.title; end if;
  if (select status from challenges where id = v_c1) <> 'settled' then raise exception 'confirmation did not settle the bet'; end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------------ a tie --
  delete from notification_outbox;
  perform pg_temp.as_user(v_uid_b);
  v_c2 := ff_create_challenge(v_league, v_uid_a, 'Week 8 rematch', 'Higher score.', 'External settlement',
                              'weekly_matchup_winner', 500, v_m2);
  perform pg_temp.as_user(v_uid_a);
  perform ff_respond_challenge(v_c2, 'accepted');
  perform pg_temp.as_user(null);
  delete from notification_outbox;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('bet-w8', 2026, 2, 8, 'NE', 'SEA', now() - interval '14 hours', 'post');
  update matchups set home_points = 90, away_points = 90 where id = v_m2;
  if ff_resolve_matchup_challenges() <> 1 then raise exception 'a tied week did not decide the bet'; end if;
  if (select status from challenges where id = v_c2) <> 'voided' then raise exception 'a tie did not void the bet'; end if;
  if (select count(*) from notification_outbox where title = 'Week 8 was a tie. Bet''s off.') <> 2 then
    raise exception 'a tie did not tell both sides';
  end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------- a co-owner has a name --
  -- A co-owner may call a shot for the seat; the push names them, not the
  -- manager whose seat it is, and not "Somebody".
  delete from notification_outbox;
  insert into auth.users (id, email) values (gen_random_uuid(), 'cal@example.com') returning id into v_uid_co;
  insert into team_co_owners (team_id, user_id, league_id) values (v_a, v_uid_co, v_league);
  perform pg_temp.as_user(v_uid_co);
  perform ff_save_settlement_profile('Cal Ripken', 'venmo', 'cal-pays');
  perform ff_create_challenge(v_league, v_uid_b, 'Kicker of the year', 'Commissioner decides.', 'Bragging rights', 'custom', null, null);
  select * into v_row from notification_outbox where user_id = v_uid_b;
  if v_row.title <> 'Cal challenged you' then raise exception 'a co-owner''s shot reads "%"', v_row.title; end if;
  perform pg_temp.as_user(null);
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- who may call --
  if has_function_privilege('authenticated', 'public.ff_remind_overdue_challenges()', 'execute') then
    raise exception 'a manager can run the reminder';
  end if;
  if has_function_privilege('authenticated', 'public.ff_resolve_matchup_challenges()', 'execute') then
    raise exception 'a manager can run the resolver';
  end if;
  v_checks := v_checks + 2;

  raise notice 'challenges: % checks passed', v_checks;
end $$;

rollback;
