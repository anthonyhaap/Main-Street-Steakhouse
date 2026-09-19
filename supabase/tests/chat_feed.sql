-- ============================================================================
-- Chat: manager messages and polls, in order, visible to members only, with
-- replies and @mentions attached.
--
-- This is half of what ff_house_feed used to cover in one file — the other
-- half, activity events and league news, is supabase/tests/league_feed.sql.
-- Splitting the test file the same way the schema split is deliberate: a
-- change that moves an event into Chat by mistake should fail here by an
-- item simply not showing up, not by an assertion that had to know about
-- both streams at once.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other uuid;
  v_a uuid; v_b uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_out uuid;
  v_feed jsonb; v_items jsonb;
  v_cursor timestamptz;
  v_top uuid; v_reply uuid;
  v_err text;
  v_checks integer := 0;
  v_base timestamptz := now() - interval '1 hour';
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values (gen_random_uuid(), 'ca@example.com') returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'cb@example.com') returning id into v_uid_b;
  insert into auth.users (id, email) values (gen_random_uuid(), 'cout@example.com') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Chat Test', 2026, v_uid_a, '["QB","RB","WR"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Chat Elsewhere', 2026, v_uid_out, '["QB","RB","WR"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Alpha', 'Ada', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Bravo', 'Bo', v_uid_b) returning id into v_b;

  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_a, 'first thing said', 'manager', v_base + interval '1 min');
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_b, 'why did you do that', 'manager', v_base + interval '2 min');

  -- League news must never show up here — it moved to the League Feed.
  insert into activity_events (league_id, event_type, headline, created_at)
  values (v_league, 'trade', 'Alpha and Bravo made a trade', v_base + interval '3 min');
  insert into league_messages (league_id, author_id, body, kind, pinned, created_at)
  values (v_league, v_uid_a, 'Draft moves to Thursday', 'announcement', true, v_base + interval '4 min');

  insert into activity_events (league_id, event_type, headline, created_at)
  values (v_other, 'trade', 'A trade in another league', v_base + interval '5 min');

  -- --------------------------------------------------------- only the room --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_feed := ff_chat_feed(v_league, null, 40);
  v_items := v_feed->'items';

  if jsonb_array_length(v_items) <> 2 then
    raise exception 'chat carried % items, expected the 2 manager messages only', jsonb_array_length(v_items);
  end if;
  v_checks := v_checks + 1;

  if exists (select 1 from jsonb_array_elements(v_items) x where x->>'source' <> 'message') then
    raise exception 'chat carried a non-message item before any poll was asked';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) x
              where x->>'body' in ('Alpha and Bravo made a trade', 'Draft moves to Thursday')) then
    raise exception 'chat leaked an event or an announcement — those belong to the League Feed now';
  end if;
  v_checks := v_checks + 2;

  if v_items->0->>'body' <> 'why did you do that' then
    raise exception 'newest item was %', v_items->0->>'body';
  end if;
  if not (v_items->1->>'mine')::boolean then raise exception 'my own line was not marked mine'; end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------------------------- a reply --
  v_top := (select id from league_messages where body = 'first thing said');
  v_reply := (ff_send_message(v_league, 'this is what I meant', v_top, null)->>'id')::uuid;

  v_feed := ff_chat_feed(v_league, null, 40);
  if (select x->'parent'->>'body' from jsonb_array_elements(v_feed->'items') x
       where (x->>'id')::uuid = v_reply) <> 'first thing said' then
    raise exception 'a reply did not carry its parent''s body';
  end if;
  v_checks := v_checks + 1;

  -- One level deep only.
  begin
    perform ff_send_message(v_league, 'a reply to a reply', v_reply, null);
    raise exception 'a reply to a reply was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a reply to a reply was accepted' then raise; end if;
  end;
  -- Replying to an announcement makes no sense either — only a manager line.
  begin
    perform ff_send_message(v_league, 'replying to the news',
      (select id from league_messages where kind = 'announcement'), null);
    raise exception 'a reply landed on an announcement';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a reply landed on an announcement' then raise; end if;
  end;
  v_checks := v_checks + 2;

  -- ------------------------------------------------------------ a mention --
  -- Bo needs a device before he can be owed a push.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_save_push_subscription('https://push.example/cb', 'key-cb', 'auth-cb', 'Firefox');

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  perform ff_send_message(v_league, 'heads up @Bo', null, array[v_uid_b]);

  v_feed := ff_chat_feed(v_league, null, 40);
  if (select jsonb_array_length(x->'mentions') from jsonb_array_elements(v_feed->'items') x
       where x->>'body' = 'heads up @Bo') <> 1 then
    raise exception 'the mention did not attach to the message';
  end if;
  if (select count(*) from notification_outbox where user_id = v_uid_b and kind = 'mention') <> 1 then
    raise exception 'the mentioned manager was not queued a push';
  end if;
  v_checks := v_checks + 2;

  -- You cannot mention someone outside the league.
  begin
    perform ff_send_message(v_league, 'hello stranger', null, array[v_uid_out]);
    raise exception 'an outsider was mentioned';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider was mentioned' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------------- a poll --
  perform ff_create_poll(v_league, 'Who wins?', array['Alpha', 'Bravo'], null);
  v_feed := ff_chat_feed(v_league, null, 40);
  if not exists (select 1 from jsonb_array_elements(v_feed->'items') x where x->>'source' = 'poll') then
    raise exception 'a poll did not reach Chat';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------- the cursor --
  -- A fresh, explicitly-ordered pair, independent of the RPC-written rows
  -- above (which all land on the same transaction timestamp and would make a
  -- cursor test meaningless — real traffic never ties like that).
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_a, 'cursor rung one', 'manager', now() + interval '20 min');
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_a, 'cursor rung two', 'manager', now() + interval '21 min');

  v_feed := ff_chat_feed(v_league, null, 1);
  if jsonb_array_length(v_feed->'items') <> 1 then raise exception 'the limit was ignored'; end if;
  if v_feed->'items'->0->>'body' <> 'cursor rung two' then
    raise exception 'the newest page did not lead with the newest message';
  end if;
  if v_feed->>'next_before' is null then raise exception 'a full page offered no cursor'; end if;
  v_checks := v_checks + 3;

  v_cursor := (v_feed->>'next_before')::timestamptz;
  v_feed := ff_chat_feed(v_league, v_cursor, 1);
  if v_feed->'items'->0->>'body' <> 'cursor rung one' then
    raise exception 'the second page did not move past the first rung: got %', v_feed->'items'->0->>'body';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- who may read it --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_chat_feed(v_league, null, 40);
    raise exception 'an outsider read the room';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider read the room' then raise; end if;
  end;
  v_checks := v_checks + 1;

  if has_function_privilege('anon', 'public.ff_chat_feed(uuid,timestamptz,integer)', 'execute') then
    raise exception 'anon can read chat';
  end if;
  v_checks := v_checks + 1;

  raise notice 'chat feed: % checks passed', v_checks;
end $$;

rollback;
