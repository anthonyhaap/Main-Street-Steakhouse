-- ============================================================================
-- Feed read state: "12 new since your last visit" needs a last visit.
--
-- Nothing in the schema recorded when a manager last looked at anything —
-- every unread count anyone might want, on the nav or on the front page, was
-- impossible without it. One table serves both destinations rather than two,
-- because "have you seen Chat" and "have you seen the League Feed" are the
-- same question asked twice.
--
-- The row is created lazily, by ff_unread_counts itself, stamped to `now()`
-- the first time anybody asks — not to the beginning of the league's history.
-- A manager who has never opened the app starts at zero unread, the same way
-- a brand new Slack channel does not open on every message since the account
-- was created. Only ff_mark_seen moves it forward after that.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

create table if not exists public.feed_read_state (
  user_id       uuid not null references auth.users(id) on delete cascade,
  league_id     uuid not null references public.leagues(id) on delete cascade,
  surface       text not null check (surface in ('chat', 'league_feed')),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, league_id, surface)
);

comment on table public.feed_read_state is
  'Per-manager, per-surface "last looked at this" timestamp, behind ff_unread_counts / ff_mark_seen. Created lazily at first read, stamped to that moment rather than to league history.';

alter table public.feed_read_state enable row level security;

-- No policies: every access goes through the two functions below, both
-- SECURITY DEFINER, the same shape as polls/poll_options/poll_votes. A
-- manager reading his own row directly would be harmless, but there is no
-- reader that needs it outside those two functions, so the door stays shut.
revoke all on table public.feed_read_state from public, anon, authenticated;

-- ---------------------------------------------------------------- the read --

create or replace function public.ff_unread_counts(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_seen_chat  timestamptz;
  v_seen_feed  timestamptz;
  v_chat       integer;
  v_feed       integer;
  v_teaser     jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  insert into feed_read_state (user_id, league_id, surface)
  values (v_uid, p_league_id, 'chat'), (v_uid, p_league_id, 'league_feed')
  on conflict (user_id, league_id, surface) do nothing;

  select last_seen_at into v_seen_chat from feed_read_state
   where user_id = v_uid and league_id = p_league_id and surface = 'chat';
  select last_seen_at into v_seen_feed from feed_read_state
   where user_id = v_uid and league_id = p_league_id and surface = 'league_feed';

  select count(*) into v_chat
    from league_messages lm
   where lm.league_id = p_league_id and lm.kind = 'manager'
     and lm.created_at > v_seen_chat
     and coalesce(lm.author_id <> v_uid, true);

  select count(*) into v_feed
    from (
      select created_at from activity_events ae
       where ae.league_id = p_league_id and ae.created_at > v_seen_feed
         and coalesce(ae.actor_id <> v_uid, true)
      union all
      select created_at from league_messages lm
       where lm.league_id = p_league_id and lm.kind in ('house', 'announcement')
         and lm.created_at > v_seen_feed
         and coalesce(lm.author_id <> v_uid, true)
    ) x;

  -- One line to tease the badge with: the newest thing said in chat that
  -- wasn't yours, whether or not it is still "unread" by the timestamp above.
  -- A badge with no preview is a reason to keep scrolling past it.
  select jsonb_build_object('body', left(lm.body, 140),
                             'author', coalesce(t.manager_name, t.name, 'League manager'))
    into v_teaser
    from league_messages lm
    left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
   where lm.league_id = p_league_id and lm.kind = 'manager'
     and coalesce(lm.author_id <> v_uid, true)
   order by lm.created_at desc
   limit 1;

  return jsonb_build_object('chat', v_chat, 'league_feed', v_feed, 'teaser', v_teaser);
end;
$fn$;

comment on function public.ff_unread_counts(uuid) is
  'How much has happened in Chat and the League Feed since this manager last looked, plus a one-line teaser of the newest thing said in Chat. Initializes a first-ever read to now(), so a new manager starts at zero.';

-- --------------------------------------------------------------- the write --

create or replace function public.ff_mark_seen(p_league_id uuid, p_surface text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if p_surface not in ('chat', 'league_feed') then
    raise exception 'unknown surface: %', p_surface;
  end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  insert into feed_read_state (user_id, league_id, surface, last_seen_at)
  values (v_uid, p_league_id, p_surface, now())
  on conflict (user_id, league_id, surface) do update set last_seen_at = excluded.last_seen_at;
end;
$fn$;

comment on function public.ff_mark_seen(uuid, text) is
  'Bumps this manager''s last-seen timestamp for one surface (chat or league_feed) to now, called when the corresponding page is actually viewed.';

-- ------------------------------------------------------------- the grants --

revoke execute on function public.ff_unread_counts(uuid)      from public, anon;
revoke execute on function public.ff_mark_seen(uuid, text)     from public, anon;

grant execute on function public.ff_unread_counts(uuid)       to authenticated, service_role;
grant execute on function public.ff_mark_seen(uuid, text)      to authenticated, service_role;
