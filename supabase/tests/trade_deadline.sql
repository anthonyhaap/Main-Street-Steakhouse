-- ============================================================================
-- The trade deadline's run-up: the instant it closes, the week post, the last
-- day's push, and the shut market — each once, each in its window, and every
-- offer still on the table expired when it lands.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_late uuid; v_draft uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_x uuid;
  v_kick timestamptz := date_trunc('hour', now()) + interval '10 days 1 hour 15 minutes';
  v_closes timestamptz;
  v_offer uuid; v_msg uuid;
  v_j jsonb; v_err text; v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values ('DDD','Deadline','DDD')
    on conflict (id) do nothing;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at)
  values ('dl-1', 2026, 2, 12, 'DDD', 'DDD', v_kick - interval '3 days'),
         ('dl-2', 2026, 2, 12, 'DDD', 'DDD', v_kick);

  insert into leagues (name, season, team_count, roster_slots, settings)
  values ('Deadline Test', 2026, 3, '["QB","BN"]'::jsonb, '{"trade_deadline_week": 12}'::jsonb)
  returning id into v_league;
  -- A league still drafting: nothing to run up to.
  insert into leagues (name, season, team_count, roster_slots, settings)
  values ('Still Drafting', 2026, 2, '["QB","BN"]'::jsonb, '{"trade_deadline_week": 12}'::jsonb)
  returning id into v_late;

  insert into auth.users (email) values ('dla@example.test') returning id into v_uid_a;
  insert into auth.users (email) values ('dlb@example.test') returning id into v_uid_b;
  insert into auth.users (email) values ('dlx@example.test') returning id into v_uid_x;

  insert into teams (league_id, name, owner_id) values (v_league, 'Alpha', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, owner_id) values (v_league, 'Bravo', v_uid_b) returning id into v_b;
  insert into teams (league_id, name) values (v_league, 'Charlie') returning id into v_c;
  insert into teams (league_id, name, owner_id) values (v_late, 'Xray', v_uid_x);

  insert into drafts (league_id, rounds, status) values (v_league, 2, 'complete') returning id into v_draft;
  insert into drafts (league_id, rounds, status) values (v_late, 2, 'setup');

  insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
    (v_uid_a, 'https://push.test/dla', 'k', 'a'), (v_uid_b, 'https://push.test/dlb', 'k', 'a'),
    (v_uid_x, 'https://push.test/dlx', 'k', 'a');

  -- Alpha has an offer out to Bravo, and Bravo already made one deal.
  insert into trades (league_id, proposer_team_id, receiver_team_id, week, status)
  values (v_league, v_a, v_b, 11, 'proposed') returning id into v_offer;
  insert into trades (league_id, proposer_team_id, receiver_team_id, week, status)
  values (v_league, v_b, v_c, 9, 'accepted');

  -- ------------------------------------------------------------ the instant --
  v_closes := ff_trade_deadline_at(v_league);
  if v_closes is distinct from v_kick + interval '4 hours' then
    raise exception 'trades close at %, expected four hours after the last kickoff (%)', v_closes, v_kick + interval '4 hours';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the read --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  v_j := ff_trade_deadline(v_league, v_b);
  if (v_j->>'deadline_week')::int <> 12 or (v_j->>'closes_at')::timestamptz <> v_closes
     or (v_j->>'offers')::int <> 1 or (v_j->>'trades')::int <> 1 or (v_j->>'waiting')::int <> 1 then
    raise exception 'the deadline read was wrong: %', v_j;
  end if;
  -- Bravo asking about Alpha's inbox learns nothing.
  if ff_trade_deadline(v_league, v_a)->'waiting' <> 'null'::jsonb then
    raise exception 'a manager read another team''s waiting offers';
  end if;
  v_checks := v_checks + 2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_x)::text, true);
  begin
    perform ff_trade_deadline(v_league, null);
    raise exception 'a manager from another league read this one''s deadline';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%not a member%' then raise; end if;
  end;
  v_checks := v_checks + 1;
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------- too early: nothing --
  perform ff_trade_deadline_tick(v_closes - interval '8 days');
  if exists (select 1 from trade_deadline_posts where league_id = v_league) then
    raise exception 'the run-up started more than a week out';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------- the week --
  perform ff_trade_deadline_tick(v_closes - interval '5 days');
  select count(*) into v_n from league_messages
   where league_id = v_league and kind = 'house' and body like '⏳ Trade deadline week.%' and pinned;
  if v_n <> 1 then raise exception 'the deadline week was pinned % times, expected once', v_n; end if;
  if not exists (select 1 from league_messages where league_id = v_league
                  and body like '%until ___ %:__ _M ET, after Monday night''s game.%') then
    raise exception 'the week post did not name the closing time on the league''s clock: %',
      (select body from league_messages where league_id = v_league and body like '⏳%');
  end if;
  if (select count(*) from activity_events where league_id = v_league and event_type = 'deadline') <> 1 then
    raise exception 'the deadline week did not reach the activity feed once';
  end if;
  select count(*) into v_n from notification_outbox
   where user_id in (v_uid_a, v_uid_b) and kind = 'trade' and title = 'Trade deadline week'
     and body like '%1 offer on the table.';
  if v_n <> 2 then raise exception 'the deadline week reached % of two managers', v_n; end if;
  v_checks := v_checks + 4;

  -- The league still drafting heard nothing.
  if exists (select 1 from notification_outbox where user_id = v_uid_x)
     or exists (select 1 from trade_deadline_posts where league_id = v_late) then
    raise exception 'a league with no draft yet was told about a trade deadline';
  end if;
  v_checks := v_checks + 1;

  -- Again, the same week: no second post.
  perform ff_trade_deadline_tick(v_closes - interval '4 days');
  if (select count(*) from league_messages where league_id = v_league and body like '⏳%') <> 1
     or (select count(*) from notification_outbox where user_id = v_uid_a) <> 1 then
    raise exception 'running the job twice in deadline week posted twice';
  end if;
  v_checks := v_checks + 1;

  -- -------------------------------------------------------------- the day --
  perform ff_trade_deadline_tick(v_closes - interval '2 hours');
  if not exists (select 1 from notification_outbox where user_id = v_uid_b and title = 'Last day to trade'
                  and body like '%1 offer is waiting on you.') then
    raise exception 'the last day did not tell Bravo about the offer waiting on him';
  end if;
  if not exists (select 1 from notification_outbox where user_id = v_uid_a and title = 'Last day to trade'
                  and body not like '%waiting on you%') then
    raise exception 'the last day told Alpha about offers that are not waiting on him';
  end if;
  perform ff_trade_deadline_tick(v_closes - interval '1 hour');
  if (select count(*) from notification_outbox where title = 'Last day to trade') <> 2 then
    raise exception 'the last day was pushed more than once';
  end if;
  v_checks := v_checks + 3;

  -- ----------------------------------------------------------- the close --
  perform ff_trade_deadline_tick(v_closes + interval '10 minutes');
  if (select status from trades where id = v_offer) <> 'invalid'
     or (select outcome from trades where id = v_offer) <> 'expired at the trade deadline' then
    raise exception 'an offer on the table survived the deadline';
  end if;
  if (select status from trades where league_id = v_league and status <> 'invalid') <> 'accepted' then
    raise exception 'the deadline touched a trade that was already done';
  end if;
  if exists (select 1 from league_messages where league_id = v_league and body like '⏳%' and pinned) then
    raise exception 'the deadline week stayed pinned after it closed';
  end if;
  if not exists (select 1 from league_messages where league_id = v_league
                  and body like '🔒 The trade deadline has passed. 1 trade this season.%' and not pinned) then
    raise exception 'the house did not say the market was shut';
  end if;
  if not exists (select 1 from activity_events where league_id = v_league and event_type = 'deadline'
                  and headline = 'The trade deadline has passed' and detail = '1 offer still on the table expired.') then
    raise exception 'the close did not reach the activity feed';
  end if;
  if not exists (select 1 from notification_outbox where user_id = v_uid_a and title = 'Your offer expired'
                  and body like '%to Bravo unanswered.')
     or not exists (select 1 from notification_outbox where user_id = v_uid_b and title = 'An offer expired'
                  and body like 'Alpha''s offer to you%') then
    raise exception 'both sides of the expired offer were not told';
  end if;
  v_checks := v_checks + 6;

  perform ff_trade_deadline_tick(v_closes + interval '1 hour');
  if (select count(*) from league_messages where league_id = v_league and body like '🔒%') <> 1 then
    raise exception 'the close was announced twice';
  end if;
  v_checks := v_checks + 1;

  -- -------------------------------------------- a deadline long gone: quiet --
  update leagues set settings = settings || '{"trade_deadline_week": 12}'::jsonb where id = v_late;
  update drafts set status = 'complete' where league_id = v_late;
  perform ff_trade_deadline_tick(v_closes + interval '3 days');
  if exists (select 1 from trade_deadline_posts where league_id = v_late) then
    raise exception 'a deadline three days gone was announced';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('authenticated', 'public.ff_trade_deadline_tick(timestamptz)', 'execute') then
    raise exception 'a manager can run the deadline job';
  end if;
  if has_function_privilege('anon', 'public.ff_trade_deadline(uuid,uuid)', 'execute') then
    raise exception 'the deadline read is open to anonymous callers';
  end if;
  v_checks := v_checks + 2;

  raise notice 'trade deadline: % checks passed', v_checks;
end $$;

rollback;
