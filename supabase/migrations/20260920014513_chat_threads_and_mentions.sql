-- ============================================================================
-- Threaded replies and @mentions: Chat stops being one flat list.
--
-- Two additions, deliberately kept small. `parent_id` points a reply at the
-- message it answers, one level deep only — a reply to a reply would need a
-- real thread view to stay readable, and this app does not have one, so the
-- schema does not pretend it does. `message_mentions` is a join table rather
-- than an array column on the message, because "who was mentioned" is read
-- from the other direction too: a manager's own notification history.
--
-- The trigger on league_messages is defense in depth, not the main guard —
-- ff_send_message already refuses a parent that is not a top-level manager
-- message in this league. It exists because league_messages is written from
-- more than one place (ff_send_message, ff_send_matchup_message, the weekly
-- recap, ff_post_announcement), and a future caller reusing `parent_id`
-- without reading ff_send_message first should fail loudly, not quietly file
-- a reply under a house post.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

-- ------------------------------------------------------------- the schema --

alter table public.league_messages
  add column if not exists parent_id uuid references public.league_messages(id) on delete set null;

create index if not exists league_messages_parent_idx
  on public.league_messages (parent_id) where parent_id is not null;

comment on column public.league_messages.parent_id is
  'The manager message this one replies to, one level deep only. Null for a top-level line, a house post or an announcement.';

create or replace function public.ff_validate_message_parent()
returns trigger
language plpgsql
as $fn$
declare
  v_parent public.league_messages%rowtype;
begin
  if new.parent_id is null then return new; end if;

  if new.parent_id = new.id then
    raise exception 'a message cannot reply to itself';
  end if;

  select * into v_parent from public.league_messages where id = new.parent_id;
  if not found then
    raise exception 'the message being replied to does not exist';
  end if;
  if v_parent.league_id <> new.league_id then
    raise exception 'a reply must stay in the same league as the message it answers';
  end if;
  if v_parent.kind <> 'manager' then
    raise exception 'only a manager''s message can be replied to';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'replies stay one level deep';
  end if;

  return new;
end;
$fn$;

drop trigger if exists league_messages_validate_parent on public.league_messages;
create trigger league_messages_validate_parent
  before insert or update of parent_id on public.league_messages
  for each row execute function public.ff_validate_message_parent();

create table if not exists public.message_mentions (
  message_id uuid not null references public.league_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

comment on table public.message_mentions is
  'Who was @mentioned in a chat message. Written only by ff_send_message, which is also what checks the mentioned manager actually holds a seat in the league.';

create index if not exists message_mentions_user_idx on public.message_mentions (user_id);

alter table public.message_mentions enable row level security;

drop policy if exists message_mentions_read on public.message_mentions;
create policy message_mentions_read on public.message_mentions
  for select to authenticated using (
    exists (select 1 from public.league_messages lm
             where lm.id = message_mentions.message_id
               and public.ff_is_member(lm.league_id))
  );

-- Read only through the policy above; every write goes through ff_send_message.
revoke all on table public.message_mentions from public, anon, authenticated;
grant select on table public.message_mentions to authenticated;

-- ------------------------------------------------------------ the pushes --

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('trade','waiver','challenge','recap','announcement','mention'));

alter table public.notification_prefs
  add column if not exists mentions boolean not null default true;

comment on column public.notification_prefs.mentions is
  'Somebody put your name in a chat message. Off by default for nobody, same rule as every other kind.';

-- Restated in full, same shape as 20260918120000, with one more field.

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
    'mentions',      coalesce((select mentions      from notification_prefs where user_id = auth.uid()), true),
    'devices',       (select count(*) from push_subscriptions where user_id = auth.uid()))
  where auth.uid() is not null
$$;

drop function if exists public.ff_set_notification_prefs(boolean, boolean, boolean, boolean, boolean);

create function public.ff_set_notification_prefs(
  p_trades boolean, p_waivers boolean, p_challenges boolean default null,
  p_recaps boolean default null, p_announcements boolean default null, p_mentions boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into notification_prefs (user_id, trades, waivers, challenges, recaps, announcements, mentions)
  values (auth.uid(), coalesce(p_trades, true), coalesce(p_waivers, true),
          coalesce(p_challenges, true), coalesce(p_recaps, true), coalesce(p_announcements, true),
          coalesce(p_mentions, true))
  on conflict (user_id) do update
    set trades        = excluded.trades,
        waivers       = excluded.waivers,
        challenges    = coalesce(p_challenges, notification_prefs.challenges),
        recaps        = coalesce(p_recaps, notification_prefs.recaps),
        announcements = coalesce(p_announcements, notification_prefs.announcements),
        mentions      = coalesce(p_mentions, notification_prefs.mentions),
        updated_at    = now();
  return ff_notification_prefs();
end $$;

-- Byte-identical to 20260918120000 but for the one new branch of the case.
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
           when 'mention'      then coalesce(p.mentions,      true)
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
-- Dropped rather than overloaded: two signatures sharing the (uuid, text)
-- prefix would leave a PostgREST call missing the new keys ambiguous, same
-- reasoning as every other RPC this project has ever widened.

drop function if exists public.ff_send_message(uuid, text);

create function public.ff_send_message(
  p_league_id uuid, p_body text, p_parent_id uuid default null, p_mentions uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_body       text := btrim(p_body);
  v_id         uuid;
  v_at         timestamptz;
  v_parent     league_messages%rowtype;
  v_mentioned  uuid[];
  v_notified   integer := 0;
  v_m          uuid;
  v_author     text;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'a message must be 1 to 1000 characters';
  end if;

  if p_parent_id is not null then
    select * into v_parent from league_messages where id = p_parent_id;
    if not found or v_parent.league_id <> p_league_id then
      raise exception 'the message you are replying to was not found';
    end if;
    if v_parent.kind <> 'manager' then
      raise exception 'you can only reply to a manager''s message';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'replies stay one level deep — reply to the original message instead';
    end if;
  end if;

  insert into league_messages (league_id, author_id, body, parent_id)
  values (p_league_id, v_uid, v_body, p_parent_id)
  returning id, created_at into v_id, v_at;

  -- De-duplicated, self excluded — mentioning yourself should not queue a
  -- push to yourself — and every remaining id has to actually hold a seat
  -- here. The composer only offers teammates, but this is the only door that
  -- can be trusted to have checked.
  select array_agg(distinct u) into v_mentioned
    from unnest(coalesce(p_mentions, '{}'::uuid[])) u
   where u <> v_uid;

  if v_mentioned is not null and array_length(v_mentioned, 1) > 0 then
    foreach v_m in array v_mentioned loop
      if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_m)) then
        raise exception 'you can only mention a manager in this league';
      end if;
    end loop;

    insert into message_mentions (message_id, user_id)
    select v_id, m from unnest(v_mentioned) m
    on conflict do nothing;

    select coalesce(t.manager_name, t.name, 'A manager') into v_author
      from teams t where t.id = public.ff_seat_team(p_league_id, v_uid);

    foreach v_m in array v_mentioned loop
      if public.ff_notify(v_m, 'mention', coalesce(v_author, 'A manager') || ' mentioned you',
                           v_body, '/chat') is not null then
        v_notified := v_notified + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', v_id, 'at', v_at, 'notified', v_notified);
end;
$fn$;

comment on function public.ff_send_message(uuid, text, uuid, uuid[]) is
  'Posts a chat message, optionally as a reply (one level deep) and/or @mentioning teammates, who are pushed if they have notifications on.';

-- ------------------------------------------------------------- the grants --

-- The trigger's alone, never a manager's to call directly.
revoke execute on function public.ff_validate_message_parent()                                               from public, anon, authenticated;

revoke execute on function public.ff_notification_prefs()                                                    from public, anon;
revoke execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
revoke execute on function public.ff_notify(uuid,text,text,text,text)                                        from public, anon, authenticated;
revoke execute on function public.ff_send_message(uuid,text,uuid,uuid[])                                     from public, anon;

grant execute on function public.ff_notification_prefs()                                                     to authenticated, service_role;
grant execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean,boolean,boolean)  to authenticated, service_role;
grant execute on function public.ff_notify(uuid,text,text,text,text)                                         to service_role;
grant execute on function public.ff_send_message(uuid,text,uuid,uuid[])                                      to authenticated, service_role;
