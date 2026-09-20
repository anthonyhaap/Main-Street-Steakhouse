-- ============================================================================
-- Unread: caught up by default only through a week ago, and never behind on
-- your own line.
--
-- now() is frozen for the life of this transaction, so "before" and "after"
-- mark-seen are built with explicit offsets off that frozen instant rather
-- than by letting real time pass between statements.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_out uuid;
  v_msg uuid;
  v_seen timestamptz;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('ua@example.test')   returning id into v_uid_a;
  insert into auth.users (email) values ('ub@example.test')   returning id into v_uid_b;
  insert into auth.users (email) values ('uout@example.test') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Unread Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;

  insert into teams (league_id, name, owner_id) values (v_league, 'Alpha', v_uid_a);
  insert into teams (league_id, name, owner_id) values (v_league, 'Bravo', v_uid_b);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);

  -- --------------------------------------------------- nothing, nothing owed --
  if ff_feed_unread_count(v_league) <> 0 then raise exception 'an empty House was not zero'; end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------ the default 7-day bound --
  -- Never having opened the House is treated as caught up through a week ago,
  -- not through the dawn of the league.
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_b, 'inside the window', 'manager', now() - interval '3 days') returning id into v_msg;
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_b, 'outside the window', 'manager', now() - interval '10 days');

  if ff_feed_unread_count(v_league) <> 1 then
    raise exception 'the default bound counted %, expected 1', ff_feed_unread_count(v_league);
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ catching up --
  v_seen := ff_feed_mark_seen(v_league);
  if v_seen is null then raise exception 'marking seen returned nothing'; end if;
  if ff_feed_unread_count(v_league) <> 0 then raise exception 'marking seen did not zero the count'; end if;
  v_checks := v_checks + 2;

  -- A second look with nothing new said stays caught up.
  if ff_feed_unread_count(v_league) <> 0 then raise exception 'an unchanged House drifted from zero'; end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- everything since, but --
  -- A message from somebody else counts...
  insert into league_messages (league_id, author_id, body, kind, created_at)
  values (v_league, v_uid_b, 'said after catching up', 'manager', now() + interval '1 second');
  if ff_feed_unread_count(v_league) <> 1 then raise exception 'a new message from Bravo was not counted'; end if;
  v_checks := v_checks + 1;

  -- ...and so does a league event, a poll from someone else, and a reply from
  -- someone else...
  insert into activity_events (league_id, event_type, headline, created_at)
  values (v_league, 'waiver', 'Waivers cleared', now() + interval '2 seconds');
  if ff_feed_unread_count(v_league) <> 2 then raise exception 'a new event was not counted'; end if;
  v_checks := v_checks + 1;

  -- ...but never your own line, in any of the four streams.
  insert into polls (league_id, author_id, question, created_at)
  values (v_league, v_uid_a, 'mine, not owed to me', now() + interval '3 seconds');
  if ff_feed_unread_count(v_league) <> 2 then raise exception 'my own poll counted against me'; end if;
  v_checks := v_checks + 1;

  insert into polls (league_id, author_id, question, created_at)
  values (v_league, v_uid_b, 'Bravo asked this', now() + interval '4 seconds');
  if ff_feed_unread_count(v_league) <> 3 then raise exception 'a poll from someone else was not counted'; end if;
  v_checks := v_checks + 1;

  insert into feed_replies (league_id, source, target_id, author_id, body, created_at)
  values (v_league, 'message', v_msg, v_uid_a, 'my own reply', now() + interval '5 seconds');
  if ff_feed_unread_count(v_league) <> 3 then raise exception 'my own reply counted against me'; end if;
  v_checks := v_checks + 1;

  insert into feed_replies (league_id, source, target_id, author_id, body, created_at)
  values (v_league, 'message', v_msg, v_uid_b, 'Bravo replying', now() + interval '6 seconds');
  if ff_feed_unread_count(v_league) <> 4 then raise exception 'a reply from someone else was not counted'; end if;
  v_checks := v_checks + 1;

  -- Marking seen again is an upsert, not a second row. (now() is frozen for
  -- the life of this transaction, so a second call here cannot advance past
  -- the items above the way a real, later call in production would — that
  -- part is proven by the upsert shape, not by the count changing again.)
  perform ff_feed_mark_seen(v_league);
  if (select count(*) from feed_reads where user_id = v_uid_a and league_id = v_league) <> 1 then
    raise exception 'marking seen twice left more than one row';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the refusals --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_feed_unread_count(v_league);
    raise exception 'an outsider read an unread count for a league he is not in';
  exception when others then
    if sqlerrm not like '%not a member%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- Marking a league seen is the same door: a stranger must not be able to
  -- plant a read-marker in a league he never joined.
  begin
    perform ff_feed_mark_seen(v_league);
    raise exception 'an outsider marked a league he is not in as seen';
  exception when others then
    if sqlerrm not like '%not a member%' then raise; end if;
  end;
  if exists (select 1 from feed_reads where user_id = v_uid_out) then
    raise exception 'an outsider''s read-marker was written despite the refusal';
  end if;
  v_checks := v_checks + 2;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('anon', 'public.ff_feed_mark_seen(uuid)', 'execute') then
    raise exception 'anon can mark the House seen';
  end if;
  if has_function_privilege('anon', 'public.ff_feed_unread_count(uuid)', 'execute') then
    raise exception 'anon can read an unread count';
  end if;
  if has_table_privilege('authenticated', 'public.feed_reads', 'insert') then
    raise exception 'a manager can insert a read-marker directly, bypassing ff_feed_mark_seen';
  end if;
  v_checks := v_checks + 3;

  raise notice 'feed unread: % checks passed', v_checks;
end $$;

rollback;
