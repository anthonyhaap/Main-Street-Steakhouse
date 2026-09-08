-- ============================================================================
-- Native push: a device that is an iPhone app rather than a browser.
--
-- Web Push does not reach a web view. The App Store build of the league is
-- the site in a frame, and Apple only lets a frame be notified through its own
-- push service, which hands the app a device token instead of an endpoint.
-- So a push_subscriptions row can now be one of two things:
--
--   platform = 'web'   endpoint is a push-service URL; p256dh and auth are
--                      the browser's keys, as before
--   platform = 'ios'   endpoint is Apple's device token; there are no keys,
--                      because Apple does the encrypting
--
-- The column is still called `endpoint` for the same reason it was unique:
-- whichever kind it is, it is the address of one device, and the row is
-- upserted on it. Everything downstream — ff_forget_push_subscription,
-- ff_push_settle's `gone` list, the device count in ff_notification_prefs —
-- already works by that address and needed no change.
-- ============================================================================

alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check check (platform in ('web', 'ios'));

-- The keys are a Web Push thing. Rather than store a placeholder Apple would
-- never read, they become nullable — but only for a row that is not web.
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth   drop not null;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_web_keys_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_web_keys_check
  check (platform <> 'web' or (p256dh is not null and auth is not null));

comment on column public.push_subscriptions.platform is
  'web: endpoint is a push-service URL with p256dh/auth keys. ios: endpoint is an APNs device token and the keys are null.';

-- ------------------------------------------------------- an iPhone's token --

-- The native twin of ff_save_push_subscription. Same rules: bound to whoever
-- is signed in NOW, so a phone that changes hands stops carrying the last
-- manager's trades; the same token again is the same device, not a second one.
create or replace function public.ff_save_native_push_token(
  p_platform   text,
  p_token      text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_platform is distinct from 'ios' then raise exception 'unknown platform'; end if;
  -- An APNs token is hex, 64 characters today and longer if Apple says so.
  if p_token is null or p_token !~ '^[0-9a-fA-F]+$' or length(p_token) not between 32 and 512 then
    raise exception 'that is not a device token';
  end if;

  insert into push_subscriptions (user_id, platform, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_platform, lower(p_token), null, null, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set user_id      = auth.uid(),
        platform     = excluded.platform,
        p256dh       = null,
        auth         = null,
        user_agent   = excluded.user_agent,
        last_seen_at = now(),
        failures     = 0
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------- the drain --

-- Unchanged but for one key: each device now says which kind it is, so the
-- drain knows whether to sign a Web Push or post to Apple.
create or replace function public.ff_push_batch(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  with taken as (
    update notification_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
     where o.id in (
       select id from notification_outbox
        where sent_at is null
          and (claimed_at is null or claimed_at < now() - interval '5 minutes')
          and attempts < 5
        order by created_at
        limit greatest(1, least(coalesce(p_limit, 50), 200))
        for update skip locked)
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'body', t.body, 'url', t.url, 'kind', t.kind,
           'devices', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'platform', s.platform,
                      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
               from push_subscriptions s where s.user_id = t.user_id)
         )), '[]'::jsonb)
    into v from taken t;

  return v;
end $$;

-- ------------------------------------------------------------- the grants --
-- The project's default privileges grant execute to authenticated; see
-- 20260905144124 and supabase/tests/grants.sql. Name every role.
revoke execute on function public.ff_save_native_push_token(text,text,text) from public, anon;
grant  execute on function public.ff_save_native_push_token(text,text,text) to authenticated, service_role;

revoke execute on function public.ff_push_batch(integer) from public, anon, authenticated;
grant  execute on function public.ff_push_batch(integer) to service_role;
