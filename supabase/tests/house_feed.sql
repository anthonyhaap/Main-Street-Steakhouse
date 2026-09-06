-- ============================================================================
-- The House feed: one stream, in one order, visible to members only.
--
-- The point of the merge is that a trade and the argument about the trade sit
-- next to each other, so the checks that matter are about ORDER across the two
-- sources and about the cursor holding while somebody is posting.
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
  v_err text;
  v_checks integer := 0;
  v_base timestamptz := now() - interval '1 hour';
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values (gen_random_uuid(), 'a@example.com') returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'b@example.com') returning id into v_uid_b;
  insert into auth.users (id, email) values (gen_random_uuid(), 'out@example.com') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('House Test', 2026, v_uid_a, '["QB","RB","WR"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Somewhere Else', 2026, v_uid_out, '["QB","RB","WR"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Alpha', 'Ada', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Bravo', 'Bo', v_uid_b) returning id into v_b;

  -- Four things, interleaved in time on purpose: said, done, said, done.
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_a, 'first thing said', 'manager', v_base + interval '1 min');
  insert into activity_events (league_id, event_type, headline, actor_id, created_at)
  values (v_league, 'transaction', 'Alpha signed a running back', v_uid_a, v_base + interval '2 min');
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_b, 'why did you do that', 'manager', v_base + interval '3 min');
  insert into activity_events (league_id, event_type, headline, detail, created_at)
  values (v_league, 'waiver', 'Waivers cleared: 2 of 5 claims awarded', 'Week 3', v_base + interval '4 min');

  -- Somebody else's league, which must never appear.
  insert into activity_events (league_id, event_type, headline, created_at)
  values (v_other, 'trade', 'A trade in another league', v_base + interval '5 min');

  -- ------------------------------------------------- both sources, one order --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_feed := ff_house_feed(v_league, null, 40);
  v_items := v_feed->'items';

  if jsonb_array_length(v_items) <> 4 then
    raise exception 'the feed carried % items, expected 4', jsonb_array_length(v_items);
  end if;
  v_checks := v_checks + 1;

  -- Newest first, and the two sources genuinely interleaved rather than
  -- concatenated — this is the whole feature.
  if v_items->0->>'body' <> 'Waivers cleared: 2 of 5 claims awarded' then
    raise exception 'newest item was %', v_items->0->>'body';
  end if;
  if v_items->1->>'body' <> 'why did you do that' then
    raise exception 'second item was %, so the sources are not interleaved', v_items->1->>'body';
  end if;
  if v_items->2->>'body' <> 'Alpha signed a running back' then
    raise exception 'third item was %', v_items->2->>'body';
  end if;
  if v_items->3->>'body' <> 'first thing said' then
    raise exception 'oldest item was %', v_items->3->>'body';
  end if;
  v_checks := v_checks + 4;

  if v_items->0->>'source' <> 'event' or v_items->1->>'source' <> 'message' then
    raise exception 'items are not labelled with which stream they came from';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ attribution --
  -- A manager's own action is his club's; a settlement the league ran has no
  -- author, because saying "The House" there would misstate who acted.
  if v_items->2->>'author' <> 'Alpha' then
    raise exception 'a transaction was attributed to %', v_items->2->>'author';
  end if;
  if v_items->0->>'author' is not null then
    raise exception 'a league-run settlement was attributed to %', v_items->0->>'author';
  end if;
  if (v_items->1->>'mine')::boolean then raise exception 'another manager''s line was marked mine'; end if;
  if not (v_items->3->>'mine')::boolean then raise exception 'my own line was not marked mine'; end if;
  v_checks := v_checks + 4;

  -- The House speaks as itself.
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, null, 'The week is written up.', 'house', v_base + interval '6 min');
  v_feed := ff_house_feed(v_league, null, 40);
  if v_feed->'items'->0->>'author' <> 'The House' then
    raise exception 'a house post was attributed to %', v_feed->'items'->0->>'author';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- another league --
  if exists (
    select 1 from jsonb_array_elements(v_feed->'items') x
     where x->>'body' = 'A trade in another league'
  ) then
    raise exception 'the feed leaked an event from a different league';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------- the cursor --
  v_feed := ff_house_feed(v_league, null, 2);
  if jsonb_array_length(v_feed->'items') <> 2 then raise exception 'the limit was ignored'; end if;
  if v_feed->>'next_before' is null then raise exception 'a full page offered no cursor'; end if;
  v_checks := v_checks + 2;

  v_cursor := (v_feed->>'next_before')::timestamptz;
  v_feed := ff_house_feed(v_league, v_cursor, 2);

  -- The second page must not repeat the first. This is what an offset would
  -- get wrong the moment somebody posts between the two calls.
  if exists (
    select 1 from jsonb_array_elements(v_feed->'items') x
     where x->>'body' in ('The week is written up.', 'Waivers cleared: 2 of 5 claims awarded')
  ) then
    raise exception 'the second page repeated the first';
  end if;
  v_checks := v_checks + 1;

  -- A page that is not full is the end, and says so by offering no cursor.
  v_feed := ff_house_feed(v_league, null, 100);
  if v_feed->>'next_before' is not null then
    raise exception 'a partial page still offered a cursor';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- who may read it --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_house_feed(v_league, null, 40);
    raise exception 'an outsider read the league feed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider read the league feed' then raise; end if;
  end;
  v_checks := v_checks + 1;

  if has_function_privilege('anon', 'public.ff_house_feed(uuid,timestamptz,integer)', 'execute') then
    raise exception 'anon can read the house feed';
  end if;
  v_checks := v_checks + 1;

  raise notice 'house feed: % checks passed', v_checks;
end $$;

rollback;
