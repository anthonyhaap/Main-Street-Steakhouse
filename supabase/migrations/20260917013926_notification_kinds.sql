-- ============================================================================
-- Two more things worth a buzz: a challenge, and the Weekly Special.
--
-- 20260906011030 built push around the two events a manager cannot look up in
-- time — an offer arriving and a claim settling. A bet is the third: the moment
-- the week decides it, the loser has to pay and the winner has to ask, and
-- neither of them is on the site at 4am on a Tuesday when the cron notices.
-- The recap is the fourth, and the only one that is not a chore: one line,
-- about you, when the house has written the week up.
--
-- This file only widens the plumbing — the kind check, the two switches, and
-- the one writer's pref lookup. The occasions themselves are the next two
-- migrations, each with its own tests. Splitting it this way means neither
-- of those has to restate ff_notify, and a mistake in one cannot mute the other.
-- ============================================================================

-- ------------------------------------------------------------- the kinds --

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('trade','waiver','challenge','recap'));

alter table public.notification_prefs
  add column if not exists challenges boolean not null default true,
  add column if not exists recaps     boolean not null default true;

comment on column public.notification_prefs.challenges is
  'A bet proposed, accepted, decided, paid, confirmed or disputed — everything on /challenges that needs the other manager to act.';
comment on column public.notification_prefs.recaps is
  'The Weekly Special, as one line about this manager''s own week, when the house posts it.';

-- ------------------------------------------------------------ the switches --

create or replace function public.ff_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'trades',     coalesce((select trades     from notification_prefs where user_id = auth.uid()), true),
    'waivers',    coalesce((select waivers    from notification_prefs where user_id = auth.uid()), true),
    'challenges', coalesce((select challenges from notification_prefs where user_id = auth.uid()), true),
    'recaps',     coalesce((select recaps     from notification_prefs where user_id = auth.uid()), true),
    'devices',    (select count(*) from push_subscriptions where user_id = auth.uid()))
  where auth.uid() is not null
$$;

-- Dropped rather than overloaded: PostgREST resolves an RPC by name and the
-- keys in the body, and two signatures that share a prefix would leave the
-- browser's call ambiguous the day one of them is sent with a key missing.
drop function if exists public.ff_set_notification_prefs(boolean, boolean);

create function public.ff_set_notification_prefs(
  p_trades boolean, p_waivers boolean, p_challenges boolean default null, p_recaps boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into notification_prefs (user_id, trades, waivers, challenges, recaps)
  values (auth.uid(), coalesce(p_trades, true), coalesce(p_waivers, true),
          coalesce(p_challenges, true), coalesce(p_recaps, true))
  on conflict (user_id) do update
    set trades     = excluded.trades,
        waivers    = excluded.waivers,
        challenges = coalesce(p_challenges, notification_prefs.challenges),
        recaps     = coalesce(p_recaps,     notification_prefs.recaps),
        updated_at = now();
  return ff_notification_prefs();
end $$;

-- ------------------------------------------------------------- the writer --
-- Byte-identical to 20260906011030 but for the two new branches of the case.

create or replace function public.ff_notify(
  p_user uuid, p_kind text, p_title text, p_body text, p_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_wants boolean;
begin
  if p_user is null then return null; end if;
  if not exists (select 1 from push_subscriptions where user_id = p_user) then
    return null;
  end if;

  select case p_kind
           when 'trade'     then coalesce(p.trades,     true)
           when 'waiver'    then coalesce(p.waivers,    true)
           when 'challenge' then coalesce(p.challenges, true)
           when 'recap'     then coalesce(p.recaps,     true)
           else true end
    into v_wants
    from (select 1) _ left join notification_prefs p on p.user_id = p_user;

  if not coalesce(v_wants, true) then return null; end if;

  insert into notification_outbox (user_id, kind, title, body, url)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 400), coalesce(p_url, '/'))
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------- the grants --
-- See 20260906011030: the project's default privileges hand EXECUTE to
-- authenticated on creation, so the service-only writer names it explicitly.
revoke execute on function public.ff_notification_prefs()                                       from public, anon;
revoke execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean)    from public, anon;
revoke execute on function public.ff_notify(uuid,text,text,text,text)                           from public, anon, authenticated;

grant execute on function public.ff_notification_prefs()                                        to authenticated, service_role;
grant execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean)     to authenticated, service_role;
grant execute on function public.ff_notify(uuid,text,text,text,text)                            to service_role;
