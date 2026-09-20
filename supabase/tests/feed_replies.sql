-- ============================================================================
-- Replies: threading onto the right stream, and not reaching across a league.
--
-- Same shape as reactions.sql, because the risk is the same one: the feed
-- merges three id spaces, so a message, an event and a poll can share a uuid.
-- A reply keyed on the id alone would land on whichever row query planning
-- happened to prefer. Forced here rather than waited for.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other uuid;
  v_a uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_out uuid;
  v_msg uuid; v_evt uuid; v_poll uuid; v_shared uuid := gen_random_uuid();
  v_far uuid;
  v_j jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('fra@example.test')  returning id into v_uid_a;
  insert into auth.users (email) values ('frb@example.test')  returning id into v_uid_b;
  insert into auth.users (email) values ('frout@example.test') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Reply Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Elsewhere', 2026, v_uid_out, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, owner_id) values (v_league, 'Bravo', v_uid_b);

  insert into league_messages (league_id, author_id, body, kind)
  values (v_league, v_uid_a, 'that was a robbery', 'manager') returning id into v_msg;
  insert into activity_events (league_id, event_type, headline)
  values (v_league, 'trade', 'Alpha and Bravo made a trade') returning id into v_evt;
  insert into polls (league_id, author_id, question) values (v_league, v_uid_a, 'who wins?') returning id into v_poll;
  insert into poll_options (poll_id, label, seq) values (v_poll, 'Alpha', 1), (v_poll, 'Bravo', 2);

  insert into activity_events (id, league_id, event_type, headline)
  values (gen_random_uuid(), v_other, 'trade', 'A trade far away') returning id into v_far;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);

  -- ------------------------------------------------------------- replying --
  v_j := ff_reply(v_league, 'message', v_msg, 'no it is not');
  if jsonb_array_length(v_j) <> 1 then raise exception 'the first reply did not land'; end if;
  if v_j->0->>'body' <> 'no it is not' then raise exception 'the reply body reads "%"', v_j->0->>'body'; end if;
  if not (v_j->0->>'mine')::boolean then raise exception 'my own reply was not marked mine'; end if;
  v_checks := v_checks + 3;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  v_j := ff_reply(v_league, 'message', v_msg, 'it absolutely is');
  if jsonb_array_length(v_j) <> 2 then raise exception 'the second reply did not join the thread'; end if;
  -- Oldest first, so the thread reads top to bottom like the argument happened.
  if v_j->0->>'body' <> 'no it is not' then raise exception 'the thread was not in order'; end if;
  if not (v_j->1->>'mine')::boolean then raise exception 'Bravo''s own reply was not marked his'; end if;
  v_checks := v_checks + 3;

  -- A poll and an event can carry replies too.
  perform ff_reply(v_league, 'poll', v_poll, 'Alpha, obviously');
  perform ff_reply(v_league, 'event', v_evt, 'about time');
  if jsonb_array_length(ff_feed_replies('poll', v_poll)) <> 1 then raise exception 'the poll reply did not land'; end if;
  if jsonb_array_length(ff_feed_replies('event', v_evt)) <> 1 then raise exception 'the event reply did not land'; end if;
  v_checks := v_checks + 2;

  -- ------------------------------------- THE ONE: a shared id across streams --
  insert into league_messages (id, league_id, author_id, body, kind)
  values (v_shared, v_league, v_uid_a, 'same uuid as an event', 'manager');
  insert into activity_events (id, league_id, event_type, headline)
  values (v_shared, v_league, 'waiver', 'same uuid as a message');

  perform ff_reply(v_league, 'message', v_shared, 'replying to the message');

  if jsonb_array_length(ff_feed_replies('message', v_shared)) <> 1 then
    raise exception 'the reply did not land on the message';
  end if;
  if jsonb_array_length(ff_feed_replies('event', v_shared)) <> 0 then
    raise exception 'a reply on a message leaked onto the event sharing its id';
  end if;
  v_checks := v_checks + 2;

  -- The feed's own reply_count keeps them apart the same way.
  v_j := ff_house_feed(v_league, null, 100);
  if (select (x->>'reply_count')::int from jsonb_array_elements(v_j->'items') x
       where (x->>'id')::uuid = v_shared and x->>'source' = 'message') <> 1 then
    raise exception 'the message''s reply_count was wrong';
  end if;
  if (select (x->>'reply_count')::int from jsonb_array_elements(v_j->'items') x
       where (x->>'id')::uuid = v_shared and x->>'source' = 'event') <> 0 then
    raise exception 'a reply on a message leaked into the event''s reply_count';
  end if;
  -- And the ordinary thread from earlier still counts two.
  if (select (x->>'reply_count')::int from jsonb_array_elements(v_j->'items') x
       where (x->>'id')::uuid = v_msg) <> 2 then
    raise exception 'the message''s reply_count did not add up';
  end if;
  v_checks := v_checks + 3;

  -- ---------------------------------------------------------- the refusals --
  begin
    perform ff_reply(v_league, 'message', v_msg, '   ');
    raise exception 'a blank reply was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a blank reply was accepted' then raise; end if;
  end;
  v_checks := v_checks + 1;

  begin
    perform ff_reply(v_league, 'event', v_far, 'reaching across leagues');
    raise exception 'a manager replied to another league''s row';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager replied to another league''s row' then raise; end if;
    if v_err not like '%no such line%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  begin
    perform ff_reply(v_league, 'message', gen_random_uuid(), 'to nothing');
    raise exception 'a manager replied to nothing';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager replied to nothing' then raise; end if;
  end;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_reply(v_league, 'message', v_msg, 'butting in');
    raise exception 'an outsider replied in a league he is not in';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider replied in a league he is not in' then raise; end if;
    if v_err not like '%not a member%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- ff_feed_replies is SECURITY DEFINER and bypasses feed_replies_read, so it
  -- has to refuse a stranger on its own — an outsider who merely knows a
  -- target_id must not be able to read the thread on it.
  begin
    perform ff_feed_replies('message', v_msg);
    raise exception 'an outsider read a thread in a league he is not in';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider read a thread in a league he is not in' then raise; end if;
    if v_err not like '%not a member%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may write --
  if has_table_privilege('authenticated', 'public.feed_replies', 'insert') then
    raise exception 'a manager can insert replies directly, bypassing every check';
  end if;
  if has_function_privilege('anon', 'public.ff_reply(uuid,text,uuid,text)', 'execute') then
    raise exception 'anon can reply';
  end if;
  v_checks := v_checks + 2;

  raise notice 'feed replies: % checks passed', v_checks;
end $$;

rollback;
