-- ============================================================================
-- push-drain — the league's push notifications, sent from the database's clock.
--
-- /api/push/drain is the one piece of push delivery that has to live outside
-- Postgres (it holds the VAPID private key). Until now Vercel Cron called it
-- every minute. On 2026-11-19 the Vercel account was on Hobby, which allows
-- only daily cron jobs, and Vercel refused to deploy anything with a
-- `* * * * *` schedule in vercel.json — every deploy, production included,
-- failed before it built. Daily would mean a trade alert a day late.
--
-- So the minute tick moves here, beside every other scheduled job: pg_cron
-- fires, pg_net makes the HTTPS call, the route does exactly what it did for
-- Vercel. The route authorises with the same bearer token Vercel Cron sent,
-- CRON_SECRET, which this side reads from Vault under the name `cron_secret`.
-- It is never written into a migration: the commissioner adds it once, in
-- the Supabase dashboard (Vault → New secret, name `cron_secret`, value the
-- same as CRON_SECRET on the Vercel project).
--
-- Until that secret exists the job FAILS rather than quietly doing nothing,
-- so the job-health panel shows push-drain red and says why.
--
-- pg_net is asynchronous: the job succeeds when the request is queued, not
-- when the route answers. The route's answers land in net._http_response for
-- a few hours if one needs reading.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.ff_push_drain_tick()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cron_secret'
   limit 1;

  if v_secret is null or v_secret = '' then
    raise exception 'push-drain: no `cron_secret` in Vault — add it (same value as CRON_SECRET on Vercel)';
  end if;

  return net.http_get(
    url                  := 'https://steakhouse.football/api/push/drain',
    headers              := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;

-- Reads a secret: nobody but the scheduler (which runs as postgres) calls it.
revoke all on function public.ff_push_drain_tick() from public, anon, authenticated;

select cron.schedule('push-drain', '* * * * *', 'select public.ff_push_drain_tick()');
