-- ============================================================================
-- The League Feed: activity events, house posts and announcements, in order,
-- visible to members only. Chat's manager messages and polls must never
-- appear here — that half is supabase/tests/chat_feed.sql.
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
  v_uid_a uuid; v_uid_out uuid;
  v_feed jsonb; v_items jsonb;
  v_cursor timestamptz;
  v_err text;
  v_checks integer := 0;
  v_base timestamptz := now() - interval '1 hour';
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values (gen_random_uuid(), 'la@example.com') returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'lout@example.com') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Feed Test', 2026, v_uid_a, '["QB","RB","WR"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Feed Elsewhere', 2026, v_uid_out, '["QB","RB","WR"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Alpha', 'Ada', v_uid_a) returning id into v_a;

  insert into activity_events (league_id, event_type, headline, actor_id, created_at)
  values (v_league, 'transaction', 'Alpha signed a running back', v_uid_a, v_base + interval '1 min');
  insert into activity_events (league_id, event_type, headline, detail, created_at)
  values (v_league, 'waiver', 'Waivers cleared: 2 of 5 claims awarded', 'Week 3', v_base + interval '2 min');

  -- Chat must never show up here.
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_a, 'that was a robbery', 'manager', v_base + interval '3 min');

  insert into activity_events (league_id, event_type, headline, created_at)
  values (v_other, 'trade', 'A trade in another league', v_base + interval '4 min');

  -- ------------------------------------------------------------- the order --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_feed := ff_league_feed(v_league, null, 40);
  v_items := v_feed->'items';

  if jsonb_array_length(v_items) <> 2 then
    raise exception 'the League Feed carried % items, expected the 2 events only', jsonb_array_length(v_items);
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) x where x->>'body' = 'that was a robbery') then
    raise exception 'the League Feed leaked a manager''s chat line';
  end if;
  v_checks := v_checks + 2;

  if v_items->0->>'body' <> 'Waivers cleared: 2 of 5 claims awarded' then
    raise exception 'newest item was %', v_items->0->>'body';
  end if;
  if v_items->1->>'author' <> 'Alpha' then
    raise exception 'a transaction was attributed to %', v_items->1->>'author';
  end if;
  v_checks := v_checks + 2;

  -- The House speaks as itself, and it can be pinned (Sunday Live).
  insert into league_messages (league_id, author_id, body, kind, pinned, created_at)
  values (v_league, null, 'The week is written up.', 'house', true, v_base + interval '5 min');
  v_feed := ff_league_feed(v_league, null, 40);
  if v_feed->'items'->0->>'author' <> 'The House' then
    raise exception 'a house post was attributed to %', v_feed->'items'->0->>'author';
  end if;
  if jsonb_array_length(v_feed->'pinned') <> 1 then
    raise exception 'a pinned house post did not reach the rail';
  end if;
  v_checks := v_checks + 2;

  -- --------------------------------------------------------- another league --
  if exists (select 1 from jsonb_array_elements(v_feed->'items') x where x->>'body' = 'A trade in another league') then
    raise exception 'the feed leaked an event from a different league';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------- the cursor --
  v_feed := ff_league_feed(v_league, null, 2);
  if jsonb_array_length(v_feed->'items') <> 2 then raise exception 'the limit was ignored'; end if;
  if v_feed->>'next_before' is null then raise exception 'a full page offered no cursor'; end if;
  v_checks := v_checks + 2;

  v_cursor := (v_feed->>'next_before')::timestamptz;
  v_feed := ff_league_feed(v_league, v_cursor, 40);
  if exists (select 1 from jsonb_array_elements(v_feed->'items') x where x->>'body' = 'The week is written up.') then
    raise exception 'the second page repeated the first';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- who may read it --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_league_feed(v_league, null, 40);
    raise exception 'an outsider read the league feed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider read the league feed' then raise; end if;
  end;
  v_checks := v_checks + 1;

  if has_function_privilege('anon', 'public.ff_league_feed(uuid,timestamptz,integer)', 'execute') then
    raise exception 'anon can read the league feed';
  end if;
  v_checks := v_checks + 1;

  raise notice 'league feed: % checks passed', v_checks;
end $$;

rollback;
