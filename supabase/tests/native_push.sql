-- ============================================================================
-- Native push: an iPhone app is a device too.
--
-- The App Store build registers an Apple device token where a browser
-- registers an endpoint. The checks below are that the two kinds live in the
-- same table by the same rules — the same token is the same device, a phone
-- that changes hands is rebound, a token can be forgotten — and that the
-- drain says which kind each one is, because that is the only thing it has
-- to decide differently.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_uid_a uuid; v_uid_b uuid;
  v_token constant text := repeat('ab', 32);
  v_n integer;
  v_checks integer := 0;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'a@example.com') returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'b@example.com') returning id into v_uid_b;

  -- ------------------------------------------------------------ registering --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  perform ff_save_native_push_token('ios', upper(v_token), 'Steakhouse/1.0 iPhone');

  select count(*) into v_n from push_subscriptions where platform = 'ios' and endpoint = v_token;
  if v_n <> 1 then raise exception 'an iPhone token was not stored as an ios device'; end if;
  if (select p256dh from push_subscriptions where endpoint = v_token) is not null then
    raise exception 'an ios device carries Web Push keys it can never use';
  end if;
  v_checks := v_checks + 2;

  -- The same token again is the same phone.
  perform ff_save_native_push_token('ios', v_token, 'Steakhouse/1.1 iPhone');
  select count(*) into v_n from push_subscriptions;
  if v_n <> 1 then raise exception 're-registering a token made a duplicate'; end if;
  v_checks := v_checks + 1;

  -- A phone that changes hands stops carrying the last manager's trades.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_save_native_push_token('ios', v_token, 'Steakhouse/1.1 iPhone');
  if (select user_id from push_subscriptions where endpoint = v_token) <> v_uid_b then
    raise exception 'a re-registered phone still belongs to the previous manager';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------- what is refused --
  begin
    perform ff_save_native_push_token('android', v_token, null);
    raise exception 'an unknown platform was accepted';
  exception when others then
    if sqlerrm not like '%unknown platform%' then raise; end if;
  end;
  begin
    perform ff_save_native_push_token('ios', 'not a token', null);
    raise exception 'a non-hex token was accepted';
  exception when others then
    if sqlerrm not like '%not a device token%' then raise; end if;
  end;
  -- A web row cannot lose its keys; the constraint, not the function, holds that.
  begin
    insert into push_subscriptions (user_id, platform, endpoint, p256dh, auth)
    values (v_uid_b, 'web', 'https://push.example/keyless', null, null);
    raise exception 'a web device with no keys was accepted';
  exception when check_violation then null;
  end;
  v_checks := v_checks + 3;

  -- --------------------------------------------------------- the drain sees --
  perform ff_save_push_subscription('https://push.example/b1', 'key-b', 'auth-b', 'Firefox');
  perform ff_notify(v_uid_b, 'trade', 'An offer', 'Tap to look at it.', '/trades');

  if (select count(*) from jsonb_array_elements(ff_push_batch(10)->0->'devices') d
       where d->>'platform' = 'ios' and d->>'endpoint' = v_token) <> 1 then
    raise exception 'the drain was not told which device is the iPhone';
  end if;
  v_checks := v_checks + 1;

  -- Apple saying a token is gone is the same as a push service saying so.
  perform ff_push_settle('{}', '[]'::jsonb, array[v_token]);
  if exists (select 1 from push_subscriptions where endpoint = v_token) then
    raise exception 'a token Apple called gone survived';
  end if;
  v_checks := v_checks + 1;

  -- A manager can forget his own phone by its token.
  perform ff_save_native_push_token('ios', v_token, null);
  if not ff_forget_push_subscription(v_token) then
    raise exception 'a manager could not forget his own phone';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may call --
  if not has_function_privilege('authenticated', 'public.ff_save_native_push_token(text,text,text)', 'execute') then
    raise exception 'a manager cannot register his own phone';
  end if;
  if has_function_privilege('anon', 'public.ff_save_native_push_token(text,text,text)', 'execute') then
    raise exception 'anon can register a phone';
  end if;
  if has_function_privilege('authenticated', 'public.ff_push_batch(integer)', 'execute') then
    raise exception 'a manager can read the whole league''s pending notifications';
  end if;
  v_checks := v_checks + 3;

  raise notice 'native push: % checks passed', v_checks;
end $$;

rollback;
