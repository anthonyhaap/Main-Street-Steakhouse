-- ============================================================================
-- Unread: a number on the door, not a fresh push.
--
-- Push already covers the two things a manager cannot look up later — an offer
-- and a settled claim — and now a few more he would rather not miss. None of
-- that answers "has anything happened in the House since I last looked", which
-- is a question worth a badge on the nav item even when the answer is nothing
-- a push would ever fire for: a dozen lines of banter, three more reactions,
-- a poll somebody asked.
--
-- One row per manager: the last time he was caught up. Not per-item read
-- receipts — nobody needs to know which of forty lines you have and have not
-- seen, only whether you are behind at all. A manager who has never opened the
-- House is treated as caught up through a week ago rather than through the
-- dawn of the league, the same bound ff_clubhouse_feed's count_7d already
-- uses, so a brand new seat does not open to a badge reading "very many".
-- ============================================================================

create table if not exists public.feed_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  league_id    uuid not null references public.leagues(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, league_id)
);

comment on table public.feed_reads is
  'One row per manager per league: the last time he was caught up on the House. No row means "not caught up past a week ago" — see ff_feed_unread_count.';

alter table public.feed_reads enable row level security;

drop policy if exists feed_reads_own on public.feed_reads;
create policy feed_reads_own on public.feed_reads
  for select to authenticated using (user_id = auth.uid());

-- Read only. Written by ff_feed_mark_seen, which is bound to whoever is
-- signed in now — same reasoning ff_save_push_subscription gives.
revoke all on table public.feed_reads from public, anon, authenticated;
grant select on table public.feed_reads to authenticated;

-- ------------------------------------------------------------- catching up --

create or replace function public.ff_feed_mark_seen(p_league_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'sign in first'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  insert into feed_reads (user_id, league_id, last_seen_at)
  values (v_uid, p_league_id, v_now)
  on conflict (user_id, league_id) do update set last_seen_at = excluded.last_seen_at;
  return v_now;
end $$;

-- ------------------------------------------------------------- the count --

create or replace function public.ff_feed_unread_count(p_league_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_since timestamptz;
  v_n     integer;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  select coalesce(
    (select last_seen_at from feed_reads where user_id = v_uid and league_id = p_league_id),
    now() - interval '7 days'
  ) into v_since;

  -- Everything the House renders, minus what the caller wrote himself — a
  -- manager does not need to be told he is behind on his own line.
  select
      (select count(*) from league_messages lm
        where lm.league_id = p_league_id and lm.created_at > v_since
          and lm.author_id is distinct from v_uid)
    + (select count(*) from activity_events ae
        where ae.league_id = p_league_id and ae.created_at > v_since)
    + (select count(*) from polls pl
        where pl.league_id = p_league_id and pl.created_at > v_since
          and pl.author_id is distinct from v_uid)
    + (select count(*) from feed_replies fr
        where fr.league_id = p_league_id and fr.created_at > v_since
          and fr.author_id is distinct from v_uid)
    into v_n;

  -- A badge reads "12", not "247" — the number only has to say "you are
  -- behind", not settle exactly how behind.
  return least(coalesce(v_n, 0), 99);
end $$;

revoke execute on function public.ff_feed_mark_seen(uuid)    from public, anon;
revoke execute on function public.ff_feed_unread_count(uuid) from public, anon;
grant execute on function public.ff_feed_mark_seen(uuid)     to authenticated, service_role;
grant execute on function public.ff_feed_unread_count(uuid)  to authenticated, service_role;
