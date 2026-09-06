-- ============================================================================
-- Push notifications: a subscription, a preference, and an outbox.
--
-- Waivers and trades are the two features that need this to work at all. A
-- blind claim you do not know settled, and an offer you do not know arrived,
-- are both features nobody uses. Everything else the league does is worth
-- looking up; these two come to you or they do not happen.
--
-- Three tables, because they answer three different questions:
--
--   push_subscriptions  where a manager can be reached (one row per device)
--   notification_prefs  what he wants to be reached about
--   notification_outbox what is owed to him but not yet delivered
--
-- The outbox exists so that sending is not on the critical path of a trade. A
-- push that fails, or a Web Push endpoint that is briefly down, must not roll
-- back the trade that caused it — so nothing here calls out to the world. Rows
-- are written inside the transaction that caused them and drained afterwards
-- by /api/push/drain, which is the only thing that holds the VAPID key.
--
-- The events are caught with TRIGGERS rather than by editing ff_propose_trade,
-- ff_respond_trade and ff_run_waivers. Those functions were applied hours ago
-- and re-declaring three long bodies to add one line each is how a transcription
-- error gets into a working function. Triggers also catch every path into the
-- tables, including the service role's, which an edit to the RPCs would not.
-- ============================================================================

-- ----------------------------------------------------------- where to reach --

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- The endpoint IS the identity of a subscription, and the browser may hand
  -- the same one back after a re-subscribe, so it is unique and upserted on.
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- A push service answering 404 or 410 means this device is gone for good.
  -- The row is deleted rather than flagged, because a dead endpoint has no
  -- second life: the browser issues a new one.
  failures    integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'One row per browser that has granted notification permission. Deleted when its push service reports the endpoint gone.';

-- ------------------------------------------------------------ what to send --

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trades  boolean not null default true,
  waivers boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.notification_prefs is
  'Per-manager switches. A missing row means "everything on" — a manager who has never opened the settings should still hear that his claim was awarded.';

-- --------------------------------------------------------------- what is owed --

create table if not exists public.notification_outbox (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('trade','waiver')),
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null check (char_length(body) between 1 and 400),
  url        text not null default '/',
  created_at timestamptz not null default now(),
  -- Set when a drain takes the row, so two overlapping drains cannot both send
  -- it. Cleared back to null if the send fails, which is what makes a retry a
  -- retry rather than a duplicate.
  claimed_at timestamptz,
  sent_at    timestamptz,
  attempts   integer not null default 0,
  last_error text
);
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at) where sent_at is null;

comment on table public.notification_outbox is
  'Notifications owed to a manager. Written inside the transaction that caused them so a failing push can never roll back a trade; drained by /api/push/drain.';

alter table public.push_subscriptions  enable row level security;
alter table public.notification_prefs  enable row level security;
alter table public.notification_outbox enable row level security;

-- A manager sees his own devices and his own switches, and nobody else's. The
-- outbox gets RLS with NO policy on purpose: it is drained by the service role
-- and there is no version of this app where a manager reads the queue of
-- messages owed to other people. Fail closed, deliberately.
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notification_prefs_own on public.notification_prefs;
create policy notification_prefs_own on public.notification_prefs
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.push_subscriptions, public.notification_prefs,
                    public.notification_outbox from public, anon;
grant select on table public.push_subscriptions, public.notification_prefs to authenticated;

-- ------------------------------------------------------- a manager's devices --

create or replace function public.ff_save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
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
  if coalesce(btrim(p_endpoint), '') = '' then raise exception 'no endpoint'; end if;

  -- Bound to whoever is signed in NOW, not to whoever registered it before: a
  -- shared laptop that changes hands must not keep pushing the last manager's
  -- trades to the new one.
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set user_id      = auth.uid(),
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = excluded.user_agent,
        last_seen_at = now(),
        failures     = 0
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.ff_forget_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- --------------------------------------------------------------- the switches --

create or replace function public.ff_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'trades',  coalesce((select trades  from notification_prefs where user_id = auth.uid()), true),
    'waivers', coalesce((select waivers from notification_prefs where user_id = auth.uid()), true),
    'devices', (select count(*) from push_subscriptions where user_id = auth.uid()))
  where auth.uid() is not null
$$;

create or replace function public.ff_set_notification_prefs(
  p_trades boolean, p_waivers boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into notification_prefs (user_id, trades, waivers)
  values (auth.uid(), coalesce(p_trades, true), coalesce(p_waivers, true))
  on conflict (user_id) do update
    set trades = excluded.trades, waivers = excluded.waivers, updated_at = now();
  return ff_notification_prefs();
end $$;

-- ------------------------------------------------------------ owing a message --

-- The one place a notification is created. Silent by design when the manager
-- has no device or has switched that kind off — an outbox row that can never
-- be delivered is a queue that only ever grows.
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
           when 'trade'  then coalesce(p.trades,  true)
           when 'waiver' then coalesce(p.waivers, true)
           else true end
    into v_wants
    from (select 1) _ left join notification_prefs p on p.user_id = p_user;

  if not coalesce(v_wants, true) then return null; end if;

  insert into notification_outbox (user_id, kind, title, body, url)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 400), coalesce(p_url, '/'))
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------- the occasions --

-- An offer arriving. The receiving manager is the one who has to do something
-- about it, so he is the only one told.
create or replace function public.ff_on_trade_proposed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_to uuid; v_from text; v_in integer; v_out integer;
begin
  select owner_id into v_to from teams where id = new.receiver_team_id;
  select name into v_from from teams where id = new.proposer_team_id;
  select count(*) into v_in  from trade_items where trade_id = new.id and to_team_id = new.receiver_team_id;
  select count(*) into v_out from trade_items where trade_id = new.id and from_team_id = new.receiver_team_id;

  perform ff_notify(v_to, 'trade', coalesce(v_from, 'Somebody') || ' sent you an offer',
    case
      when v_in > 0 and v_out > 0 then v_in || ' for ' || v_out || '. Tap to look at it.'
      when v_in > 0               then 'Offering you ' || v_in || ', asking for nothing.'
      when v_out > 0              then 'Asking for ' || v_out || ' of yours.'
      else 'Tap to look at it.'
    end, '/trades');
  return null;
end $$;

drop trigger if exists trades_notify_proposed on public.trades;
create trigger trades_notify_proposed
  after insert on public.trades
  for each row when (new.status = 'proposed')
  execute function public.ff_on_trade_proposed();

-- An offer answered. Only the manager who made it is waiting on the answer;
-- 'countered' is deliberately not announced here, because the counter is
-- itself an insert and has already fired the trigger above.
create or replace function public.ff_on_trade_answered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_to uuid; v_other text;
begin
  if new.status not in ('accepted','declined') then return null; end if;

  select owner_id into v_to    from teams where id = new.proposer_team_id;
  select name     into v_other from teams where id = new.receiver_team_id;

  perform ff_notify(v_to, 'trade',
    coalesce(v_other, 'Somebody') || ' ' || new.status || ' your offer',
    case when new.status = 'accepted'
         then 'The players have moved. Tap to see the deal.'
         else 'No deal this time.' end, '/trades');
  return null;
end $$;

drop trigger if exists trades_notify_answered on public.trades;
create trigger trades_notify_answered
  after update of status on public.trades
  for each row when (old.status = 'proposed' and new.status is distinct from old.status)
  execute function public.ff_on_trade_answered();

-- A settlement. Every manager who had a claim in hears what became of it,
-- which is the whole point of a blind queue: you find out on Wednesday.
create or replace function public.ff_on_waiver_settled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_to uuid; v_player text;
begin
  if new.status not in ('won','lost','invalid') then return null; end if;

  select owner_id into v_to from teams where id = new.team_id;
  select full_name into v_player from players where id = new.add_player_id;

  perform ff_notify(v_to, 'waiver',
    case new.status
      when 'won'  then 'You got ' || coalesce(v_player, 'your claim')
      when 'lost' then 'You missed ' || coalesce(v_player, 'your claim')
      else 'Your claim on ' || coalesce(v_player, 'a player') || ' did not stand'
    end,
    coalesce(new.outcome, 'Waivers have settled.'), '/waivers');
  return null;
end $$;

drop trigger if exists waiver_claims_notify_settled on public.waiver_claims;
create trigger waiver_claims_notify_settled
  after update of status on public.waiver_claims
  for each row when (old.status = 'pending' and new.status is distinct from old.status)
  execute function public.ff_on_waiver_settled();

-- ---------------------------------------------------------------- the drain --

-- Claim a batch. `claimed_at` rather than a delete-on-read so that a drain
-- which dies mid-flight releases its rows after five minutes instead of losing
-- them, and `for update skip locked` so two overlapping drains take different
-- work rather than the same work twice.
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
                      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
               from push_subscriptions s where s.user_id = t.user_id)
         )), '[]'::jsonb)
    into v from taken t;

  return v;
end $$;

-- What the drain learned. Sent rows are closed; failed rows go back in the
-- queue by clearing the claim; endpoints the push service called gone are
-- deleted, because a 404 or 410 there is permanent.
create or replace function public.ff_push_settle(
  p_sent uuid[] default '{}',
  p_failed jsonb default '[]',
  p_gone text[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer := 0; v_row jsonb;
begin
  update notification_outbox set sent_at = now(), claimed_at = null, last_error = null
   where id = any(coalesce(p_sent, '{}'));
  get diagnostics v_n = row_count;

  for v_row in select * from jsonb_array_elements(coalesce(p_failed, '[]'::jsonb)) loop
    update notification_outbox
       set claimed_at = null, last_error = left(coalesce(v_row->>'error', 'unknown'), 300)
     where id = (v_row->>'id')::uuid;
  end loop;

  delete from push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));

  return v_n;
end $$;

-- ------------------------------------------------------------- the grants --
-- `revoke ... from public, anon` is NOT enough on this project: it carries
-- `alter default privileges ... grant execute on functions to ... authenticated`.
-- Anything not manager-callable must name authenticated too. See 20260905144124
-- and supabase/tests/grants.sql, which asserts exactly this.
revoke execute on function public.ff_save_push_subscription(text,text,text,text) from public, anon;
revoke execute on function public.ff_forget_push_subscription(text)              from public, anon;
revoke execute on function public.ff_notification_prefs()                        from public, anon;
revoke execute on function public.ff_set_notification_prefs(boolean,boolean)     from public, anon;
revoke execute on function public.ff_notify(uuid,text,text,text,text)            from public, anon, authenticated;
revoke execute on function public.ff_push_batch(integer)                         from public, anon, authenticated;
revoke execute on function public.ff_push_settle(uuid[],jsonb,text[])            from public, anon, authenticated;
revoke execute on function public.ff_on_trade_proposed()                         from public, anon, authenticated;
revoke execute on function public.ff_on_trade_answered()                         from public, anon, authenticated;
revoke execute on function public.ff_on_waiver_settled()                         from public, anon, authenticated;

grant execute on function public.ff_save_push_subscription(text,text,text,text) to authenticated, service_role;
grant execute on function public.ff_forget_push_subscription(text)              to authenticated, service_role;
grant execute on function public.ff_notification_prefs()                        to authenticated, service_role;
grant execute on function public.ff_set_notification_prefs(boolean,boolean)     to authenticated, service_role;
-- The drain's own three, and the writer they share. Nothing a manager holds.
grant execute on function public.ff_notify(uuid,text,text,text,text)            to service_role;
grant execute on function public.ff_push_batch(integer)                         to service_role;
grant execute on function public.ff_push_settle(uuid[],jsonb,text[])            to service_role;
