-- ============================================================================
-- Pinned announcements: only the commissioner posts one, it holds the rail
-- until unpinned, and it never stops being a line in the ordinary feed.
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
  v_uid_a uuid; v_uid_b uuid;
  v_msg uuid; v_at timestamptz;
  v_j jsonb; v_feed jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('pa@example.test') returning id into v_uid_a;
  insert into auth.users (email) values ('pb@example.test') returning id into v_uid_b;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Announce Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_uid_b) returning id into v_b;

  -- Bravo has a device, so posting the announcement can be checked to have
  -- actually queued something for him.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_save_push_subscription('https://push.example/pb', 'key-b', 'auth-b', 'Firefox');

  -- ------------------------------------------------- only the commissioner --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  begin
    perform ff_post_announcement(v_league, 'Draft moves to Thursday');
    raise exception 'a non-commissioner posted an announcement';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a non-commissioner posted an announcement' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------- the post --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_post_announcement(v_league, 'Draft moves to Thursday at 8pm.');
  v_msg := (v_j->>'id')::uuid;
  if v_msg is null then raise exception 'the announcement did not return an id'; end if;
  v_checks := v_checks + 1;

  -- Bravo has a device and was not the poster, so he was owed a push.
  if (v_j->>'notified')::int <> 1 then
    raise exception 'expected one manager notified, got %', v_j->>'notified';
  end if;
  v_checks := v_checks + 1;

  if (select kind from league_messages where id = v_msg) <> 'announcement' then
    raise exception 'the post was not written as an announcement';
  end if;
  if not (select pinned from league_messages where id = v_msg) then
    raise exception 'a freshly posted announcement was not pinned';
  end if;
  v_checks := v_checks + 2;

  if (select count(*) from notification_outbox where user_id = v_uid_b and kind = 'announcement') <> 1 then
    raise exception 'bravo was not queued a push for the announcement';
  end if;
  if exists (select 1 from notification_outbox where user_id = v_uid_a) then
    raise exception 'the commissioner was pushed his own announcement';
  end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------------------------- the feed --
  v_feed := ff_league_feed(v_league, null, 40);

  -- It is a line in the ordinary stream, like anything else said.
  if not exists (select 1 from jsonb_array_elements(v_feed->'items') x where (x->>'id')::uuid = v_msg) then
    raise exception 'the announcement did not appear in the ordinary feed';
  end if;
  v_checks := v_checks + 1;

  -- And it heads the pinned rail, with the commissioner's name on it.
  if jsonb_array_length(v_feed->'pinned') <> 1 then
    raise exception 'the pinned rail carried % items, expected 1', jsonb_array_length(v_feed->'pinned');
  end if;
  if (v_feed->'pinned'->0->>'id')::uuid <> v_msg then
    raise exception 'the pinned rail did not carry the announcement';
  end if;
  if v_feed->'pinned'->0->>'author' <> 'Ada' then
    raise exception 'the pinned announcement was attributed to %, not the commissioner', v_feed->'pinned'->0->>'author';
  end if;
  v_checks := v_checks + 3;

  -- ----------------------------------------------- only announcements pin --
  begin
    perform ff_set_announcement_pinned((select id from league_messages where league_id = v_league and kind <> 'announcement' limit 1), true);
    raise exception 'an ordinary message was pinned';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an ordinary message was pinned' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- --------------------------------------------------- unpin, only by him --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  begin
    perform ff_set_announcement_pinned(v_msg, false);
    raise exception 'a non-commissioner unpinned the announcement';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a non-commissioner unpinned the announcement' then raise; end if;
  end;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_set_announcement_pinned(v_msg, false);
  if (v_j->>'pinned')::boolean then raise exception 'unpinning left it pinned'; end if;
  v_checks := v_checks + 1;

  v_feed := ff_league_feed(v_league, null, 40);
  if jsonb_array_length(v_feed->'pinned') <> 0 then
    raise exception 'the rail still carried an unpinned announcement';
  end if;
  -- It is still a line the league said, unpinning only takes it off the rail.
  if not exists (select 1 from jsonb_array_elements(v_feed->'items') x where (x->>'id')::uuid = v_msg) then
    raise exception 'unpinning erased the announcement from the feed';
  end if;
  v_checks := v_checks + 2;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('anon', 'public.ff_post_announcement(uuid,text)', 'execute') then
    raise exception 'anon can post an announcement';
  end if;
  if has_function_privilege('anon', 'public.ff_set_announcement_pinned(uuid,boolean)', 'execute') then
    raise exception 'anon can pin or unpin an announcement';
  end if;
  v_checks := v_checks + 2;

  raise notice 'pinned announcements: % checks passed', v_checks;
end $$;

rollback;
