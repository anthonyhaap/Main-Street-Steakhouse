-- ============================================================================
-- Push notifications: who gets told what, and who does not.
--
-- The interesting cases here are all restraint. A notification system that
-- errs towards sending is worse than none, because the league turns it off
-- once and never turns it back on. So most of what follows checks that a
-- message is NOT written: to a manager with no device, to one who switched
-- that kind off, to the person who performed the action himself, and for a
-- counter, which would otherwise announce itself twice.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_draft uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_c uuid;
  v_pa uuid; v_pb uuid;
  v_trade uuid; v_counter uuid;
  v_claim uuid;
  v_n integer; v_row record;
  v_batch jsonb;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values (gen_random_uuid(), 'a@example.com') returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'b@example.com') returning id into v_uid_b;
  insert into auth.users (id, email) values (gen_random_uuid(), 'c@example.com') returning id into v_uid_c;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Push Test', 2026, v_uid_a,
          '["QB","RB","WR","TE","FLEX","K","DEF"]'::jsonb,
          '{"trade_deadline_week": 20}'::jsonb)
  returning id into v_league;

  insert into drafts (league_id, status) values (v_league, 'complete') returning id into v_draft;

  insert into teams (league_id, name, owner_id) values (v_league, 'Alpha', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, owner_id) values (v_league, 'Bravo', v_uid_b) returning id into v_b;
  insert into teams (league_id, name, owner_id) values (v_league, 'Charlie', v_uid_c) returning id into v_c;

  insert into players (full_name, position, nfl_team) values ('Alpha Man','RB','MIA') returning id into v_pa;
  insert into players (full_name, position, nfl_team) values ('Bravo Man','WR','BUF') returning id into v_pb;

  -- ------------------------------- nobody is told until they can be reached --
  -- No device registered yet, so the offer below must leave no trace. An
  -- outbox that fills up for managers who never subscribed is a queue that
  -- only ever grows.
  insert into trades (league_id, proposer_team_id, receiver_team_id, week, status)
  values (v_league, v_a, v_b, 3, 'proposed') returning id into v_trade;

  select count(*) into v_n from notification_outbox;
  if v_n <> 0 then raise exception 'wrote % notification(s) for a manager with no device', v_n; end if;
  v_checks := v_checks + 1;

  delete from trades where id = v_trade;

  -- ------------------------------------------------------- register devices --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_save_push_subscription('https://push.example/b1', 'key-b', 'auth-b', 'Firefox');
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  perform ff_save_push_subscription('https://push.example/a1', 'key-a', 'auth-a', 'Safari');

  select count(*) into v_n from push_subscriptions;
  if v_n <> 2 then raise exception 'expected two devices, found %', v_n; end if;
  v_checks := v_checks + 1;

  -- Re-registering the same endpoint is the same device, not a second one.
  perform ff_save_push_subscription('https://push.example/a1', 'key-a2', 'auth-a2', 'Safari');
  select count(*) into v_n from push_subscriptions;
  if v_n <> 2 then raise exception 're-registering an endpoint made a duplicate'; end if;
  if (select p256dh from push_subscriptions where endpoint = 'https://push.example/a1') <> 'key-a2' then
    raise exception 're-registering did not refresh the key';
  end if;
  v_checks := v_checks + 2;

  -- A shared browser changing hands rebinds the endpoint rather than leaving
  -- the last manager's trades going to the new one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_c)::text, true);
  perform ff_save_push_subscription('https://push.example/a1', 'key-c', 'auth-c', 'Safari');
  if (select user_id from push_subscriptions where endpoint = 'https://push.example/a1') <> v_uid_c then
    raise exception 'a re-registered device still belongs to the previous manager';
  end if;
  v_checks := v_checks + 1;
  -- Put it back to A for the rest of the file.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  perform ff_save_push_subscription('https://push.example/a1', 'key-a', 'auth-a', 'Safari');

  -- ------------------------------------------------------------- an offer --
  delete from notification_outbox;
  insert into trades (league_id, proposer_team_id, receiver_team_id, week, status)
  values (v_league, v_a, v_b, 3, 'proposed') returning id into v_trade;

  select count(*) into v_n from notification_outbox;
  if v_n <> 1 then raise exception 'an offer produced % notifications, expected 1', v_n; end if;
  select * into v_row from notification_outbox limit 1;
  if v_row.user_id <> v_uid_b then raise exception 'the offer told the wrong manager'; end if;
  if v_row.kind <> 'trade' then raise exception 'the offer was filed as %', v_row.kind; end if;
  if v_row.url <> '/trades' then raise exception 'the offer points at %', v_row.url; end if;
  if v_row.title not like 'Alpha%' then raise exception 'the offer does not name who sent it: %', v_row.title; end if;
  v_checks := v_checks + 5;

  -- The manager who made the offer is not told about his own action.
  if exists (select 1 from notification_outbox where user_id = v_uid_a) then
    raise exception 'the proposer was notified of his own offer';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ the answer --
  delete from notification_outbox;
  update trades set status = 'declined' where id = v_trade;

  select count(*) into v_n from notification_outbox where user_id = v_uid_a;
  if v_n <> 1 then raise exception 'declining told the proposer % times', v_n; end if;
  if exists (select 1 from notification_outbox where user_id = v_uid_b) then
    raise exception 'the manager who declined was told about his own answer';
  end if;
  v_checks := v_checks + 2;

  -- A second update on a settled offer says nothing more.
  delete from notification_outbox;
  update trades set status = 'invalid' where id = v_trade;
  select count(*) into v_n from notification_outbox;
  if v_n <> 0 then raise exception 'a already-settled offer notified again'; end if;
  v_checks := v_checks + 1;

  -- A counter is an insert, so it announces itself once as a new offer. The
  -- 'countered' status left on the offer it answers must stay silent, or the
  -- proposer hears about the same event twice.
  delete from notification_outbox;
  insert into trades (league_id, proposer_team_id, receiver_team_id, week, status)
  values (v_league, v_a, v_b, 3, 'proposed') returning id into v_trade;
  delete from notification_outbox;

  insert into trades (league_id, proposer_team_id, receiver_team_id, week, status, counters_id)
  values (v_league, v_b, v_a, 3, 'proposed', v_trade) returning id into v_counter;
  update trades set status = 'countered' where id = v_trade;

  select count(*) into v_n from notification_outbox where user_id = v_uid_a;
  if v_n <> 1 then raise exception 'a counter told the other manager % times, expected once', v_n; end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- the switches --
  delete from notification_outbox;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_set_notification_prefs(false, true);          -- trades off, waivers on
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);

  insert into trades (league_id, proposer_team_id, receiver_team_id, week, status)
  values (v_league, v_a, v_b, 3, 'proposed');
  if exists (select 1 from notification_outbox where user_id = v_uid_b) then
    raise exception 'a manager who switched trades off was told about one';
  end if;
  v_checks := v_checks + 1;

  -- And the other kind still reaches him, so the switch is a switch and not a
  -- mute button.
  insert into waiver_claims (league_id, team_id, add_player_id, week, status)
  values (v_league, v_b, v_pa, 3, 'pending') returning id into v_claim;
  update waiver_claims set status = 'won', outcome = 'awarded' where id = v_claim;

  select count(*) into v_n from notification_outbox where user_id = v_uid_b and kind = 'waiver';
  if v_n <> 1 then raise exception 'a settled claim told its owner % times', v_n; end if;
  if (select title from notification_outbox where user_id = v_uid_b and kind = 'waiver')
     not like '%Alpha Man%' then
    raise exception 'the waiver notice does not name the player';
  end if;
  v_checks := v_checks + 2;

  -- A claim that is still pending is not news.
  delete from notification_outbox;
  insert into waiver_claims (league_id, team_id, add_player_id, week, status)
  values (v_league, v_b, v_pb, 3, 'pending');
  if exists (select 1 from notification_outbox) then
    raise exception 'filing a claim notified somebody';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------- the drain --
  delete from notification_outbox;
  perform ff_notify(v_uid_b, 'waiver', 'Title', 'Body', '/waivers');

  v_batch := ff_push_batch(10);
  if jsonb_array_length(v_batch) <> 1 then
    raise exception 'the drain took % rows, expected 1', jsonb_array_length(v_batch);
  end if;
  if jsonb_array_length(v_batch->0->'devices') <> 1 then
    raise exception 'the batch carried % devices for a manager with one', jsonb_array_length(v_batch->0->'devices');
  end if;
  if v_batch->0->'devices'->0->>'endpoint' <> 'https://push.example/b1' then
    raise exception 'the batch carried the wrong endpoint';
  end if;
  v_checks := v_checks + 3;

  -- A second drain running straight afterwards takes nothing: the first still
  -- holds the claim. This is what stops two overlapping crons double-sending.
  if jsonb_array_length(ff_push_batch(10)) <> 0 then
    raise exception 'an overlapping drain took rows the first one had claimed';
  end if;
  v_checks := v_checks + 1;

  -- Settling closes it, and a later drain does not see it again.
  perform ff_push_settle(array[(v_batch->0->>'id')::uuid], '[]'::jsonb, '{}');
  if (select sent_at from notification_outbox where id = (v_batch->0->>'id')::uuid) is null then
    raise exception 'a settled message was not marked sent';
  end if;
  if jsonb_array_length(ff_push_batch(10)) <> 0 then
    raise exception 'a sent message came round again';
  end if;
  v_checks := v_checks + 2;

  -- A failure puts it back rather than losing it.
  delete from notification_outbox;
  perform ff_notify(v_uid_b, 'waiver', 'Retry', 'Body', '/waivers');
  v_batch := ff_push_batch(10);
  perform ff_push_settle('{}', jsonb_build_array(jsonb_build_object(
    'id', v_batch->0->>'id', 'error', 'push service 503')), '{}');
  if (select claimed_at from notification_outbox where id = (v_batch->0->>'id')::uuid) is not null then
    raise exception 'a failed message stayed claimed and can never retry';
  end if;
  if jsonb_array_length(ff_push_batch(10)) <> 1 then
    raise exception 'a failed message did not come back for another go';
  end if;
  v_checks := v_checks + 2;

  -- An endpoint the push service calls gone is deleted, not retried forever.
  perform ff_push_settle('{}', '[]'::jsonb, array['https://push.example/b1']);
  if exists (select 1 from push_subscriptions where endpoint = 'https://push.example/b1') then
    raise exception 'a dead endpoint survived being reported gone';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('authenticated', 'public.ff_push_batch(integer)', 'execute') then
    raise exception 'a manager can read the whole league''s pending notifications';
  end if;
  if has_function_privilege('authenticated', 'public.ff_notify(uuid,text,text,text,text)', 'execute') then
    raise exception 'a manager can write into another manager''s outbox';
  end if;
  if not has_function_privilege('authenticated', 'public.ff_save_push_subscription(text,text,text,text)', 'execute') then
    raise exception 'a manager cannot register his own device';
  end if;
  v_checks := v_checks + 3;

  raise notice 'push: % checks passed', v_checks;
end $$;

rollback;
