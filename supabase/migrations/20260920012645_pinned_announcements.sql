-- ============================================================================
-- Pinned announcements: the House becomes the league's news wire.
--
-- The House already merges what managers say with what the league does, and
-- that made it the obvious place to stop running league news through a group
-- chat nobody can find anything in again. What it could not do yet was say
-- "this one matters more than the rest" — every line was equal, newest first,
-- gone from view the moment three more people typed.
--
-- An announcement is a fourth `league_messages.kind`, alongside 'manager' and
-- 'house': commissioner-authored, unlike 'house', because a rule change or a
-- deadline is something a person said and should carry their name, not an
-- anonymous voice. `pinned` is the only new column — true for an announcement
-- until the commissioner takes it down, always false otherwise, enforced by a
-- check rather than trusted to callers.
--
-- ff_house_feed keeps posting an announcement inline, in order, like anything
-- else said — unpinning it should not delete the record that it was said. It
-- additionally returns a `pinned` array: every currently-pinned announcement,
-- regardless of which page of the feed is loaded, so the browser can hold a
-- rail above the scroll that does not empty out the moment somebody pages
-- back through October.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

-- ------------------------------------------------------------- the schema --

alter table public.league_messages drop constraint if exists league_messages_kind_check;
alter table public.league_messages
  add constraint league_messages_kind_check check (kind in ('manager', 'house', 'announcement'));

alter table public.league_messages
  add column if not exists pinned boolean not null default false;

-- Only an announcement may be pinned. A manager's line or the house's own
-- post staying un-pinnable is the whole reason the rail reads as news rather
-- than as "whatever the commissioner starred today".
do $$ begin
  alter table public.league_messages
    add constraint league_messages_pinned_kind_check check (not pinned or kind = 'announcement');
exception when duplicate_object then null; end $$;

comment on column public.league_messages.pinned is
  'True while this announcement holds a place on the pinned rail above the House. Only ever true for kind = ''announcement''.';

-- ------------------------------------------------------------ the pushes --

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('trade','waiver','challenge','recap','announcement'));

alter table public.notification_prefs
  add column if not exists announcements boolean not null default true;

comment on column public.notification_prefs.announcements is
  'League news from the commissioner, pinned in the House. Almost nobody should want this off, but the switch follows the same rule every other kind does.';

-- ------------------------------------------------------------ the switches --
-- Restated in full, same shape as 20260917013926, with one more field.

create or replace function public.ff_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'trades',        coalesce((select trades        from notification_prefs where user_id = auth.uid()), true),
    'waivers',       coalesce((select waivers       from notification_prefs where user_id = auth.uid()), true),
    'challenges',    coalesce((select challenges    from notification_prefs where user_id = auth.uid()), true),
    'recaps',        coalesce((select recaps        from notification_prefs where user_id = auth.uid()), true),
    'announcements', coalesce((select announcements from notification_prefs where user_id = auth.uid()), true),
    'devices',       (select count(*) from push_subscriptions where user_id = auth.uid()))
  where auth.uid() is not null
$$;

-- Dropped rather than overloaded, for the same reason 20260917013926 dropped
-- the four-argument version it replaced: PostgREST resolves an RPC by name and
-- the keys in the body, and two signatures sharing a prefix leave a call with
-- a key missing ambiguous.
drop function if exists public.ff_set_notification_prefs(boolean, boolean, boolean, boolean);

create function public.ff_set_notification_prefs(
  p_trades boolean, p_waivers boolean, p_challenges boolean default null,
  p_recaps boolean default null, p_announcements boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into notification_prefs (user_id, trades, waivers, challenges, recaps, announcements)
  values (auth.uid(), coalesce(p_trades, true), coalesce(p_waivers, true),
          coalesce(p_challenges, true), coalesce(p_recaps, true), coalesce(p_announcements, true))
  on conflict (user_id) do update
    set trades        = excluded.trades,
        waivers       = excluded.waivers,
        challenges    = coalesce(p_challenges, notification_prefs.challenges),
        recaps        = coalesce(p_recaps, notification_prefs.recaps),
        announcements = coalesce(p_announcements, notification_prefs.announcements),
        updated_at    = now();
  return ff_notification_prefs();
end $$;

-- Byte-identical to 20260917013926 but for the one new branch of the case.
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
           when 'trade'        then coalesce(p.trades,        true)
           when 'waiver'       then coalesce(p.waivers,       true)
           when 'challenge'    then coalesce(p.challenges,    true)
           when 'recap'        then coalesce(p.recaps,        true)
           when 'announcement' then coalesce(p.announcements, true)
           else true end
    into v_wants
    from (select 1) _ left join notification_prefs p on p.user_id = p_user;

  if not coalesce(v_wants, true) then return null; end if;

  insert into notification_outbox (user_id, kind, title, body, url)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 400), coalesce(p_url, '/'))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- the write --

create or replace function public.ff_post_announcement(p_league_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_body text := btrim(p_body);
  v_id   uuid;
  v_at   timestamptz;
  v_t    record;
  v_u    record;
  v_sent integer := 0;
begin
  perform public.ff_assert_commissioner(p_league_id);

  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'an announcement must be 1 to 500 characters';
  end if;

  insert into league_messages(league_id, author_id, kind, body, pinned)
  values (p_league_id, v_uid, 'announcement', v_body, true)
  returning id, created_at into v_id, v_at;

  -- Every seat that plays: the owner and any co-owner, same roll call
  -- ff_recap_notify makes. The commissioner does not need his own phone to
  -- buzz about a line he just typed.
  for v_t in select t.id, t.owner_id from teams t where t.league_id = p_league_id loop
    for v_u in
      select v_t.owner_id as user_id where v_t.owner_id is not null
      union
      select co.user_id from team_co_owners co where co.team_id = v_t.id
    loop
      if v_u.user_id is distinct from v_uid
         and public.ff_notify(v_u.user_id, 'announcement', 'League announcement', v_body, '/chat') is not null then
        v_sent := v_sent + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('id', v_id, 'at', v_at, 'notified', v_sent);
end;
$fn$;

-- ------------------------------------------------------------- pin, unpin --

create or replace function public.ff_set_announcement_pinned(p_message_id uuid, p_pinned boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_msg league_messages%rowtype;
begin
  select * into v_msg from league_messages where id = p_message_id;
  if not found then raise exception 'no such announcement'; end if;
  if v_msg.kind <> 'announcement' then raise exception 'only an announcement can be pinned'; end if;

  perform public.ff_assert_commissioner(v_msg.league_id);

  update league_messages set pinned = p_pinned where id = p_message_id;

  return jsonb_build_object('id', p_message_id, 'pinned', p_pinned);
end;
$fn$;

-- ------------------------------------------------------------- the feed --
-- Re-declared to carry `pinned` on every message item, to speak an
-- announcement's author as the commissioner even when he holds no team, and to
-- return the pinned rail alongside the ordinary page. Everything else is
-- unchanged from 20260906141722.

create or replace function public.ff_house_feed(
  p_league_id uuid,
  p_before    timestamptz default null,
  p_limit     integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_team   uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_rows   jsonb;
  v_pinned jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  -- "Is this caller a member" and "which team wrote this line", both spelled
  -- through ff_seat_team rather than owner_id, per the rewrite in
  -- 20260909194727 — a co-owner holds a seat with no row in teams.owner_id,
  -- and restating this function from an older copy of its body would silently
  -- lock him back out. supabase/tests/co_owners.sql catches exactly this.
  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_team := public.ff_seat_team(p_league_id, v_uid);

  with said as (
    select lm.id, lm.created_at as at, 'message'::text as source, lm.kind,
           lm.body, null::text as detail,
           case when lm.kind = 'house' then 'The House'
                when lm.kind = 'announcement' then coalesce(t.manager_name, t.name, 'The Commissioner')
                else coalesce(t.manager_name, t.name, 'League manager') end as author,
           t.id as author_team_id,
           coalesce(lm.author_id = v_uid, false) as mine,
           lm.matchup_id, null::text as source_type, null::uuid as source_id,
           lm.pinned
      from league_messages lm
      left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
     where lm.league_id = p_league_id
       and (p_before is null or lm.created_at < p_before)
  ),
  did as (
    select ae.id, ae.created_at as at, 'event'::text as source, ae.event_type as kind,
           ae.headline as body, ae.detail,
           t.name as author, t.id as author_team_id,
           coalesce(ae.actor_id = v_uid, false) as mine,
           null::uuid as matchup_id, ae.source_type, ae.source_id,
           false as pinned
      from activity_events ae
      left join teams t on t.id = public.ff_seat_team(p_league_id, ae.actor_id)
     where ae.league_id = p_league_id
       and (p_before is null or ae.created_at < p_before)
  ),
  asked as (
    select pl.id, pl.created_at as at, 'poll'::text as source, 'poll'::text as kind,
           pl.question as body, null::text as detail,
           coalesce(t.manager_name, t.name, 'League manager') as author,
           t.id as author_team_id,
           coalesce(pl.author_id = v_uid, false) as mine,
           null::uuid as matchup_id, null::text as source_type, null::uuid as source_id,
           false as pinned
      from polls pl
      left join teams t on t.id = public.ff_seat_team(p_league_id, pl.author_id)
     where pl.league_id = p_league_id
       and (p_before is null or pl.created_at < p_before)
  ),
  merged as (
    select * from said
    union all select * from did
    union all select * from asked
    order by at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'at', m.at, 'source', m.source, 'kind', m.kind,
           'body', m.body, 'detail', m.detail,
           'author', m.author, 'author_team_id', m.author_team_id, 'mine', m.mine,
           'source_type', m.source_type, 'source_id', m.source_id,
           'pinned', m.pinned,
           'reactions', ff_reactions_for(m.source, m.id),
           'poll', case when m.source = 'poll' then ff_poll_for(m.id) else null end,
           'matchup', case when m.matchup_id is null then null else (
             select jsonb_build_object(
                      'id', mu.id, 'week', mu.week,
                      'home', th.name, 'away', ta.name,
                      'mine', v_team is not null and v_team in (mu.home_team_id, mu.away_team_id))
               from matchups mu
               join teams th on th.id = mu.home_team_id
               join teams ta on ta.id = mu.away_team_id
              where mu.id = m.matchup_id) end
         ) order by m.at desc), '[]'::jsonb)
    into v_rows from merged m;

  -- The pinned rail: every currently-pinned announcement in this league,
  -- independent of `p_before`, so unpinning one is the only way it leaves.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', lm.id, 'at', lm.created_at, 'source', 'message', 'kind', lm.kind,
           'body', lm.body, 'detail', null,
           'author', coalesce(t.manager_name, t.name, 'The Commissioner'),
           'author_team_id', t.id, 'mine', coalesce(lm.author_id = v_uid, false),
           'source_type', null, 'source_id', null, 'matchup', null, 'pinned', true,
           'reactions', ff_reactions_for('message', lm.id), 'poll', null
         ) order by lm.created_at desc), '[]'::jsonb)
    into v_pinned
    from league_messages lm
    left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
   where lm.league_id = p_league_id and lm.pinned;

  return jsonb_build_object(
    'items', v_rows,
    'pinned', v_pinned,
    'next_before', case when jsonb_array_length(v_rows) < v_limit then null
                        else (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'at') end,
    'now', now());
end $fn$;

comment on function public.ff_house_feed(uuid, timestamptz, integer) is
  'The league in one stream: what managers said and what the league did, newest first, paginated by `p_before`, plus a `pinned` array of every announcement currently held to the top.';

-- ------------------------------------------------------------- the grants --

revoke execute on function public.ff_notification_prefs()                                                    from public, anon;
revoke execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean,boolean)         from public, anon;
revoke execute on function public.ff_notify(uuid,text,text,text,text)                                        from public, anon, authenticated;
revoke execute on function public.ff_post_announcement(uuid,text)                                            from public, anon;
revoke execute on function public.ff_set_announcement_pinned(uuid,boolean)                                   from public, anon;
revoke execute on function public.ff_house_feed(uuid, timestamptz, integer)                                  from public, anon;

grant execute on function public.ff_notification_prefs()                                                     to authenticated, service_role;
grant execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean,boolean)          to authenticated, service_role;
grant execute on function public.ff_notify(uuid,text,text,text,text)                                         to service_role;
grant execute on function public.ff_post_announcement(uuid,text)                                             to authenticated, service_role;
grant execute on function public.ff_set_announcement_pinned(uuid,boolean)                                    to authenticated, service_role;
grant execute on function public.ff_house_feed(uuid, timestamptz, integer)                                   to authenticated, service_role;
