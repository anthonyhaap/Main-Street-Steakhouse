-- ============================================================================
-- Watch links: a way in that can look at everything and change nothing.
--
-- The commissioner mints a link. Whoever opens it gets an anonymous Supabase
-- session (auth.signInAnonymously) and a row in league_spectators tying that
-- session to the link, and from then on the app reads exactly as it does for
-- a manager — standings, matchups, rosters, the League Feed — with three
-- differences, all enforced here rather than in the browser:
--
--   1. Nothing can be written. A statement-level trigger on every table in
--      `public` refuses any INSERT, UPDATE or DELETE made while the caller is
--      anonymous or a spectator. Every write in the app, whether an RPC or a
--      direct table write under RLS, ends in a statement against one of those
--      tables, so this is one guard for all of them, and for every RPC
--      somebody writes later. supabase/tests/watch_links.sql fails the replay
--      if a table is added without it.
--
--   2. Chat is not theirs to read. Manager messages and polls are hidden by
--      RLS, and the five SECURITY DEFINER readers that quote chat (the
--      clubhouse card, the scoreboard's last line, Sunday's room, its recap,
--      and the League Feed) read league_messages through ff_visible_messages,
--      which drops manager lines for a spectator. ff_chat_feed and
--      ff_matchup_thread are simply not opened to them.
--
--   3. It ends. A link can expire, and the commissioner can revoke it, which
--      deletes every spectator it let in. ff_is_spectator checks the link on
--      every call, so expiry needs no job to enforce it.
--
-- The token is 64 hex characters from two v4 uuids and only its sha256 is
-- stored. It is shown to the commissioner once, when it is minted; a lost link
-- is replaced, not recovered.
--
-- Anonymous sign-ins have to be switched on for the project (Authentication ->
-- Sign In / Providers -> Allow anonymous sign-ins). Nothing an anonymous user
-- can reach is new: sign-up is already open (see 20260826030518), and an
-- anonymous session with no spectator row is a member of nothing.
-- ============================================================================

-- ---------------------------------------------------------------- tables --

create table if not exists public.watch_links (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references public.leagues(id) on delete cascade,
  token_hash   text not null unique,
  label        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);

comment on table public.watch_links is
  'Read-only links the commissioner hands out. Only the sha256 of the token is kept; the link itself is shown once, when minted.';

create table if not exists public.league_spectators (
  user_id    uuid not null references auth.users(id) on delete cascade,
  league_id  uuid not null references public.leagues(id) on delete cascade,
  link_id    uuid not null references public.watch_links(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, league_id)
);

create index if not exists league_spectators_link_idx on public.league_spectators (link_id);

comment on table public.league_spectators is
  'Anonymous sessions let in by a watch link. A row here reads the league and writes nothing anywhere.';

-- Neither table is read or written from the API directly: the commissioner
-- goes through ff_watch_links, a visitor through ff_redeem_watch_link.
alter table public.watch_links       enable row level security;
alter table public.league_spectators enable row level security;
revoke all on public.watch_links       from public, anon, authenticated;
revoke all on public.league_spectators from public, anon, authenticated;
grant  all on public.watch_links       to service_role;
grant  all on public.league_spectators to service_role;

-- --------------------------------------------------------------- helpers --

-- A live spectator of THIS league: let in by a link that is neither revoked
-- nor expired. SECURITY DEFINER because it is called from read policies, as
-- `authenticated`, and neither table is readable by that role.
create or replace function public.ff_is_spectator(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from league_spectators s
      join watch_links w on w.id = s.link_id
     where s.user_id = auth.uid()
       and s.league_id = p_league_id
       and w.revoked_at is null
       and (w.expires_at is null or w.expires_at > now()))
$$;

comment on function public.ff_is_spectator(uuid) is
  'Is the caller a live watch-link spectator of this league. Grants reading; never grants writing.';

-- The broader question the write guard and the chat filter ask: has this
-- session ever come in through a link, live or not, or is it anonymous at all.
-- An expired spectator reads nothing, and must still write nothing.
create or replace function public.ff_is_read_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
          or exists (select 1 from league_spectators where user_id = auth.uid()))
$$;

comment on function public.ff_is_read_only() is
  'True for an anonymous session or any watch-link spectator. The write guard and the chat filter both key on this.';

-- league_messages as the caller may see it. Plain SQL, not SECURITY DEFINER,
-- so the planner inlines it into the readers that select from it, and the
-- read-only test runs once per query as an initplan rather than once per row.
create or replace function public.ff_visible_messages()
returns setof public.league_messages
language sql
stable
set search_path = public
as $$
  select * from league_messages
   where kind <> 'manager' or not (select public.ff_is_read_only())
$$;

comment on function public.ff_visible_messages() is
  'league_messages minus manager chat for a read-only caller. The SECURITY DEFINER readers that quote chat select from this instead of the table.';

-- ------------------------------------------------------------ membership --

-- Both spellings, restated from 20260909194727 with the spectator clause added.
create or replace function public.ff_is_member(p_league_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams          where league_id = p_league_id and owner_id        = auth.uid())
      or exists (select 1 from team_co_owners where league_id = p_league_id and user_id         = auth.uid())
      or exists (select 1 from leagues        where id        = p_league_id and commissioner_id = auth.uid())
      or public.ff_is_spectator(p_league_id)
$$;

create or replace function public.ff_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams          where owner_id        = auth.uid())
      or exists (select 1 from team_co_owners where user_id         = auth.uid())
      or exists (select 1 from leagues        where commissioner_id = auth.uid())
      or exists (select 1 from league_spectators s where s.user_id = auth.uid()
                    and public.ff_is_spectator(s.league_id))
$$;

-- --------------------------------------------------------- the write guard --

create or replace function public.ff_refuse_read_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service role, cron and the SQL editor; that
  -- test comes first so the loaders never pay for the lookup.
  if auth.uid() is not null and public.ff_is_read_only() then
    raise exception 'this is a view-only link — nothing can be changed from it'
      using errcode = '42501';
  end if;
  return null;
end $$;

comment on function public.ff_refuse_read_only() is
  'Statement-level BEFORE trigger on every public table: a read-only caller writes nothing, by any route.';

-- Every table in public except the two this file owns, which are written only
-- by the SECURITY DEFINER functions below (ff_redeem_watch_link runs as the
-- anonymous visitor, and is the one write such a session makes).
do $guard$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not in ('watch_links', 'league_spectators')
     order by c.relname
  loop
    execute format(
      'create or replace trigger ff_read_only_guard before insert or update or delete on public.%I '
      'for each statement execute function public.ff_refuse_read_only()', t);
  end loop;
end $guard$;

-- ------------------------------------------------------- reading, by policy --

-- Chat stays the managers'. Announcements and house posts are the League
-- Feed, and a spectator reads those.
drop policy if exists league_messages_read on public.league_messages;
create policy league_messages_read on public.league_messages
  for select to authenticated
  using (public.ff_is_member(league_id)
         and (kind <> 'manager' or not (select public.ff_is_read_only())));

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls
  for select to authenticated
  using (public.ff_is_member(league_id) and not (select public.ff_is_read_only()));

-- ------------------------------------------------ reading, by RPC: the rewrite --
-- Ten readers guard themselves with
--
--   not exists (select 1 from teams where id = public.ff_seat_team(X, v_uid))
--     and <not the commissioner>
--
-- rather than ff_is_member, so widening ff_is_member does not reach them. As in
-- 20260909194727, each is read back with pg_get_functiondef and the guard is
-- extended in place rather than the bodies being copied here, which is how a
-- line goes missing. Strict both ways: a listed function without exactly one
-- such guard stops the migration.
--
-- Five readers quote chat. Their `from league_messages <alias>` becomes
-- `from public.ff_visible_messages() <alias>`, and each must have at least one.
--
-- ff_chat_feed, ff_matchup_thread, ff_unread_counts, ff_mark_seen and
-- ff_league_pulse are deliberately left out: the first two are chat, the next
-- two are a manager's read state, and the last is the commissioner's desk.
do $rewrite$
declare
  r       record;
  v_src   text;
  v_new   text;
  v_n     integer;
  v_done  text[] := '{}';
  v_left  text;
  v_guard text := 'not exists \(select 1 from teams where id = public\.ff_seat_team\(([a-z_.]+), v_uid\)\)';
  v_open  text[] := array[
    'ff_briefing', 'ff_clubhouse_feed', 'ff_history', 'ff_league_feed',
    'ff_playoff_outlook', 'ff_rivalries_for_week', 'ff_rivalry', 'ff_scoreboard',
    'ff_team_hub', 'ff_week_recap'
  ];
  v_quiet text[] := array[
    'ff_clubhouse_feed', 'ff_league_feed', 'ff_scoreboard', 'ff_sunday', 'ff_sunday_recap'
  ];
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (v_open || v_quiet)
     order by p.proname
  loop
    v_src := pg_get_functiondef(r.oid);
    v_new := v_src;

    if r.proname = any (v_open) then
      select count(*) into v_n from regexp_matches(v_src, v_guard, 'g');
      if v_n <> 1 then
        raise exception 'watch links: % has % seat guards, expected exactly one', r.proname, v_n;
      end if;
      v_new := regexp_replace(v_new, v_guard, '\& and not public.ff_is_spectator(\1)');
    end if;

    if r.proname = any (v_quiet) then
      if v_new !~ 'from league_messages [a-z]+\M' then
        raise exception 'watch links: % no longer reads league_messages the way this expects', r.proname;
      end if;
      v_new := regexp_replace(v_new, 'from league_messages ([a-z]+)\M',
                              'from public.ff_visible_messages() \1', 'g');
      if v_new ~ 'league_messages\s+[a-z]+\s+(where|on|join)' then
        raise exception 'watch links: % still reads league_messages directly after the rewrite', r.proname;
      end if;
    end if;

    execute v_new;
    v_done := v_done || r.proname;
  end loop;

  select string_agg(e, ', ') into v_left
    from unnest(v_open || v_quiet) e where e <> all (v_done);
  if v_left is not null then
    raise exception 'watch links: expected to rewrite % and could not find it', v_left;
  end if;
end $rewrite$;

-- ------------------------------------------------- the commissioner's side --

create or replace function public.ff_create_watch_link(
  p_league_id uuid,
  p_label     text    default null,
  p_days      integer default 7
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  perform ff_assert_commissioner(p_league_id);
  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'a link lasts between 1 and 365 days, or until it is revoked';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into watch_links (league_id, token_hash, label, created_by, expires_at)
  values (p_league_id,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          nullif(btrim(p_label), ''),
          auth.uid(),
          case when p_days is null then null else now() + make_interval(days => p_days) end);

  return v_token;
end $$;

comment on function public.ff_create_watch_link(uuid, text, integer) is
  'Commissioner only. Mints a read-only link and returns its token, which is never readable again. p_days null means it lasts until revoked.';

create or replace function public.ff_watch_links(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  perform ff_assert_commissioner(p_league_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',           w.id,
             'label',        w.label,
             'created_at',   w.created_at,
             'expires_at',   w.expires_at,
             'revoked_at',   w.revoked_at,
             'last_used_at', w.last_used_at,
             'live',         w.revoked_at is null and (w.expires_at is null or w.expires_at > now()),
             'visitors',     (select count(*) from league_spectators s where s.link_id = w.id))
           order by w.created_at desc)
      from watch_links w
     where w.league_id = p_league_id
  ), '[]'::jsonb);
end $$;

create or replace function public.ff_revoke_watch_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select league_id into v_league from watch_links where id = p_link_id;
  if v_league is null then raise exception 'no such link'; end if;
  perform ff_assert_commissioner(v_league);

  update watch_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
  -- Everyone it let in is out on their next request, not when it expires.
  delete from league_spectators where link_id = p_link_id;
end $$;

-- ---------------------------------------------------------- the visitor's --

-- Whether a link is worth signing in for. Anon-callable, so /watch can turn a
-- dead link away before minting an anonymous user for it. It takes the secret
-- and answers yes or no, like ff_invite_preview.
create or replace function public.ff_watch_link_live(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from watch_links
     where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
       and revoked_at is null
       and (expires_at is null or expires_at > now()))
$$;

create or replace function public.ff_redeem_watch_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_link watch_links%rowtype;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  -- Only an anonymous session becomes a spectator. A manager who taps a watch
  -- link keeps his seat; turning him read-only would lock him out of his team.
  if not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'you already have an account — sign in instead';
  end if;

  select * into v_link from watch_links
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'this link has expired or been switched off — ask the commissioner for a new one';
  end if;

  insert into league_spectators (user_id, league_id, link_id)
  values (auth.uid(), v_link.league_id, v_link.id)
  on conflict (user_id, league_id) do update set link_id = excluded.link_id;

  update watch_links set last_used_at = now() where id = v_link.id;
  return v_link.league_id;
end $$;

-- ---------------------------------------------------------------- grants --
-- Default privileges hand every new function to authenticated (see
-- supabase/tests/grants.sql), so each one is named here.
revoke execute on function public.ff_is_spectator(uuid)                     from public, anon;
revoke execute on function public.ff_is_read_only()                         from public, anon;
revoke execute on function public.ff_visible_messages()                     from public, anon, authenticated;
revoke execute on function public.ff_refuse_read_only()                     from public, anon, authenticated;
revoke execute on function public.ff_create_watch_link(uuid, text, integer) from public, anon;
revoke execute on function public.ff_watch_links(uuid)                      from public, anon;
revoke execute on function public.ff_revoke_watch_link(uuid)                from public, anon;
revoke execute on function public.ff_watch_link_live(text)                  from public;
revoke execute on function public.ff_redeem_watch_link(text)                from public, anon;

-- Read policies call these as the signed-in user.
grant execute on function public.ff_is_spectator(uuid)                      to authenticated, service_role;
grant execute on function public.ff_is_read_only()                          to authenticated, service_role;
-- Called only from inside the SECURITY DEFINER readers, which run as the owner.
grant execute on function public.ff_visible_messages()                      to service_role;
grant execute on function public.ff_refuse_read_only()                      to service_role;
-- Commissioner-checked inside.
grant execute on function public.ff_create_watch_link(uuid, text, integer)  to authenticated, service_role;
grant execute on function public.ff_watch_links(uuid)                       to authenticated, service_role;
grant execute on function public.ff_revoke_watch_link(uuid)                 to authenticated, service_role;
-- The visitor: checked before signing in, redeemed straight after.
grant execute on function public.ff_watch_link_live(text)                   to anon, authenticated, service_role;
grant execute on function public.ff_redeem_watch_link(text)                 to authenticated, service_role;
