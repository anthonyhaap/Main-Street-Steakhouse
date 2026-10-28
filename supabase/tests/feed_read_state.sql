-- ============================================================================
-- Feed read state: unread counts start at zero, move only past what you
-- actually said or did yourself, and reset when you mark a surface seen.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_a uuid; v_b uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_out uuid;
  v_j jsonb;
  v_err text;
  v_checks integer := 0;
begin
  insert into auth.users (email) values ('ura@example.test') returning id into v_uid_a;
  insert into auth.users (email) values ('urb@example.test') returning id into v_uid_b;
  insert into auth.users (email) values ('urout@example.test') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Unread Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_uid_b) returning id into v_b;

  -- --------------------------------------------------- starts at zero, not history --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_unread_counts(v_league);
  if (v_j->>'chat')::int <> 0 or (v_j->>'league_feed')::int <> 0 then
    raise exception 'a first-ever read was not zero: %', v_j;
  end if;
  v_checks := v_checks + 1;

  -- `now()` is frozen for the whole test transaction, so nothing inserted
  -- from here on would ever look "newer" than the read-state row just
  -- stamped above. Pushing that row an hour into the past is the same
  -- situation a real second transaction gets for free.
  update feed_read_state set last_seen_at = now() - interval '1 hour'
   where user_id = v_uid_a and league_id = v_league;

  -- ----------------------------------------------------------- somebody talks --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_send_message(v_league, 'anybody around?');

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_unread_counts(v_league);
  if (v_j->>'chat')::int <> 1 then raise exception 'chat unread was %, expected 1', v_j->>'chat'; end if;
  if v_j->'teaser'->>'body' <> 'anybody around?' then
    raise exception 'the teaser did not carry the newest line: %', v_j->'teaser';
  end if;
  v_checks := v_checks + 2;

  -- Your own line never counts against you.
  perform ff_send_message(v_league, 'yeah, here');
  v_j := ff_unread_counts(v_league);
  if (v_j->>'chat')::int <> 1 then
    raise exception 'posting your own message changed your own unread count to %', v_j->>'chat';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ marking seen --
  perform ff_mark_seen(v_league, 'chat');
  v_j := ff_unread_counts(v_league);
  if (v_j->>'chat')::int <> 0 then raise exception 'marking chat seen left % unread', v_j->>'chat'; end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------- the league feed side --
  insert into activity_events (league_id, event_type, headline, actor_id)
  values (v_league, 'transaction', 'Bravo signed a kicker', v_uid_b);
  v_j := ff_unread_counts(v_league);
  if (v_j->>'league_feed')::int <> 1 then
    raise exception 'league feed unread was %, expected 1', v_j->>'league_feed';
  end if;
  v_checks := v_checks + 1;

  perform ff_mark_seen(v_league, 'league_feed');
  v_j := ff_unread_counts(v_league);
  if (v_j->>'league_feed')::int <> 0 then
    raise exception 'marking the league feed seen left % unread', v_j->>'league_feed';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------------- refusals --
  begin
    perform ff_mark_seen(v_league, 'nonsense');
    raise exception 'an unknown surface was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an unknown surface was accepted' then raise; end if;
  end;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_unread_counts(v_league);
    raise exception 'an outsider read unread counts';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider read unread counts' then raise; end if;
  end;
  v_checks := v_checks + 1;

  if has_function_privilege('anon', 'public.ff_unread_counts(uuid)', 'execute') then
    raise exception 'anon can read unread counts';
  end if;
  if has_function_privilege('anon', 'public.ff_mark_seen(uuid,text)', 'execute') then
    raise exception 'anon can mark a surface seen';
  end if;
  v_checks := v_checks + 2;

  raise notice 'feed read state: % checks passed', v_checks;
end $$;

rollback;
