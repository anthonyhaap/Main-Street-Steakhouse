-- ============================================================================
-- Reactions: pressing, un-pressing, and not reaching across a league.
--
-- The case worth writing this file for is the shared uuid. The feed merges two
-- id spaces, so a message and an event can hold the same id — different tables,
-- independent defaults, no reason they cannot collide. If a reaction were keyed
-- on the id alone, a flame on somebody's line would silently appear on an
-- unrelated trade. That is checked here by forcing the collision rather than
-- waiting for one.
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
  v_msg uuid; v_evt uuid; v_shared uuid := gen_random_uuid();
  v_far uuid;
  v_j jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('ra@example.test')  returning id into v_uid_a;
  insert into auth.users (email) values ('rb@example.test')  returning id into v_uid_b;
  insert into auth.users (email) values ('out@example.test') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('React Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Elsewhere', 2026, v_uid_out, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, owner_id) values (v_league, 'Alpha', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, owner_id) values (v_league, 'Bravo', v_uid_b);

  insert into league_messages (league_id, author_id, body, kind)
  values (v_league, v_uid_a, 'that was a robbery', 'manager') returning id into v_msg;
  insert into activity_events (league_id, event_type, headline)
  values (v_league, 'trade', 'Alpha and Bravo made a trade') returning id into v_evt;

  insert into activity_events (league_id, event_type, headline)
  values (v_other, 'trade', 'A trade far away') returning id into v_far;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);

  -- ------------------------------------------------------------- pressing --
  v_j := ff_react(v_league, 'message', v_msg, '🔥');
  if not (v_j->>'on')::boolean then raise exception 'the first press did not stick'; end if;
  if (v_j->>'count')::int <> 1 then raise exception 'one press counted %', v_j->>'count'; end if;
  v_checks := v_checks + 2;

  -- Pressing the same button again takes it back rather than stacking.
  v_j := ff_react(v_league, 'message', v_msg, '🔥');
  if (v_j->>'on')::boolean then raise exception 'pressing twice did not take it back'; end if;
  if (v_j->>'count')::int <> 0 then raise exception 'after un-pressing the count was %', v_j->>'count'; end if;
  v_checks := v_checks + 2;

  -- Two people, one button.
  v_j := ff_react(v_league, 'message', v_msg, '🔥');
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  v_j := ff_react(v_league, 'message', v_msg, '🔥');
  if (v_j->>'count')::int <> 2 then raise exception 'two managers made it %', v_j->>'count'; end if;
  v_checks := v_checks + 1;

  -- One person, two buttons: different reactions coexist.
  perform ff_react(v_league, 'message', v_msg, '💀');
  if (select count(*) from reactions where target_id = v_msg and user_id = v_uid_b) <> 2 then
    raise exception 'a second emoji replaced the first instead of joining it';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- what shows --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_reactions_for('message', v_msg);
  if jsonb_array_length(v_j) <> 2 then
    raise exception 'the summary showed % emoji, expected 2', jsonb_array_length(v_j);
  end if;
  -- Busiest first, so the row reads as a scoreboard.
  if v_j->0->>'emoji' <> '🔥' then raise exception 'the summary did not lead with the busiest'; end if;
  if (v_j->0->>'count')::int <> 2 then raise exception 'the flame counted %', v_j->0->>'count'; end if;
  if not (v_j->0->>'mine')::boolean then raise exception 'my own press was not marked mine'; end if;
  -- Bravo pressed the skull, Alpha did not.
  if (v_j->1->>'mine')::boolean then raise exception 'somebody else''s press was marked mine'; end if;
  v_checks := v_checks + 5;

  -- ------------------------------------- THE ONE: a shared id across streams --
  -- Force the collision the feed's two id spaces make possible. A reaction on
  -- the message must not appear on the event that happens to share its id.
  insert into league_messages (id, league_id, author_id, body, kind)
  values (v_shared, v_league, v_uid_a, 'same uuid as an event', 'manager');
  insert into activity_events (id, league_id, event_type, headline)
  values (v_shared, v_league, 'waiver', 'same uuid as a message');

  perform ff_react(v_league, 'message', v_shared, '👀');

  if jsonb_array_length(ff_reactions_for('message', v_shared)) <> 1 then
    raise exception 'the reaction did not land on the message';
  end if;
  if jsonb_array_length(ff_reactions_for('event', v_shared)) <> 0 then
    raise exception 'a reaction on a message leaked onto the event sharing its id';
  end if;
  v_checks := v_checks + 2;

  -- And the feed keeps them apart too, which is where it would actually show.
  v_j := ff_house_feed(v_league, null, 100);
  if (select count(*) from jsonb_array_elements(v_j->'items') x
       where (x->>'id')::uuid = v_shared and jsonb_array_length(x->'reactions') > 0) <> 1 then
    raise exception 'the feed put the reaction on both rows with the shared id';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the refusals --
  -- Something outside the palette.
  begin
    perform ff_react(v_league, 'message', v_msg, '🖕');
    raise exception 'an emoji outside the palette was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an emoji outside the palette was accepted' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- A target in somebody else's league, named with this league's id.
  begin
    perform ff_react(v_league, 'event', v_far, '🔥');
    raise exception 'a manager reacted to another league''s row';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager reacted to another league''s row' then raise; end if;
    if v_err not like '%no such line%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- A target that does not exist at all.
  begin
    perform ff_react(v_league, 'message', gen_random_uuid(), '🔥');
    raise exception 'a manager reacted to nothing';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager reacted to nothing' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- An outsider, in the right shape but the wrong league.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_react(v_league, 'message', v_msg, '🔥');
    raise exception 'an outsider reacted in a league he is not in';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider reacted in a league he is not in' then raise; end if;
    if v_err not like '%not a member%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may write --
  -- The table takes no writes directly; ff_react is the only door, because it
  -- is the only thing that checks the target is real and in this league.
  if has_table_privilege('authenticated', 'public.reactions', 'insert') then
    raise exception 'a manager can insert reactions directly, bypassing every check';
  end if;
  if has_table_privilege('authenticated', 'public.reactions', 'delete') then
    raise exception 'a manager can delete reactions directly';
  end if;
  if has_function_privilege('anon', 'public.ff_react(uuid,text,uuid,text)', 'execute') then
    raise exception 'anon can react';
  end if;
  v_checks := v_checks + 3;

  raise notice 'reactions: % checks passed', v_checks;
end $$;

rollback;
