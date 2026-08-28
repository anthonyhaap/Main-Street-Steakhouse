-- Main Street Steakhouse league clubhouse and social challenge foundation.
-- Real-money settlement is intentionally out of scope until an approved provider
-- and jurisdiction-aware compliance program are in place.

alter view if exists public.draft_board set (security_invoker = true);
alter view if exists public.standings set (security_invoker = true);
alter view if exists public.roster_points set (security_invoker = true);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.league_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  matchup_id uuid references public.matchups(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  event_type text not null check (event_type in ('announcement','deadline','draft','trade','waiver','score','record','challenge','system')),
  headline text not null check (char_length(headline) between 1 and 140),
  detail text check (detail is null or char_length(detail) <= 1000),
  actor_id uuid references auth.users(id) on delete set null,
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  challenger_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid not null references auth.users(id) on delete cascade,
  proposition_type text not null default 'custom' check (proposition_type in ('weekly_matchup_winner','higher_player_points','season_finish','custom')),
  title text not null check (char_length(title) between 1 and 90),
  terms text not null check (char_length(terms) between 1 and 1000),
  stake_label text not null default 'Bragging rights' check (char_length(stake_label) between 1 and 80),
  status text not null default 'proposed' check (status in ('proposed','accepted','declined','expired','locked','awaiting_result','resolved','disputed','settled','voided')),
  terms_hash text generated always as (md5(title || E'\n' || terms || E'\n' || stake_label || E'\n' || proposition_type)) stored,
  acceptance_deadline timestamptz,
  accepted_at timestamptz,
  locked_at timestamptz,
  resolved_at timestamptz,
  winner_id uuid references auth.users(id) on delete set null,
  resolution_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challenges_distinct_people check (challenger_id <> opponent_id),
  constraint challenges_acceptance_time check (acceptance_deadline is null or acceptance_deadline > created_at)
);

create table if not exists public.challenge_events (
  id bigint generated always as identity primary key,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  from_status text,
  to_status text not null,
  terms_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists league_messages_league_created_idx on public.league_messages(league_id, created_at desc);
create index if not exists activity_events_league_created_idx on public.activity_events(league_id, created_at desc);
create index if not exists challenges_league_created_idx on public.challenges(league_id, created_at desc);
create index if not exists challenges_opponent_status_idx on public.challenges(opponent_id, status);
create index if not exists challenge_events_challenge_created_idx on public.challenge_events(challenge_id, created_at);

alter table public.profiles enable row level security;
alter table public.league_messages enable row level security;
alter table public.activity_events enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_events enable row level security;

drop policy if exists profiles_read_members on public.profiles;
create policy profiles_read_members on public.profiles for select to authenticated using (public.ff_is_member());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists league_messages_read on public.league_messages;
create policy league_messages_read on public.league_messages for select to authenticated using (public.ff_is_member());
drop policy if exists league_messages_insert on public.league_messages;
create policy league_messages_insert on public.league_messages for insert to authenticated with check (public.ff_is_member() and author_id = (select auth.uid()));
drop policy if exists league_messages_update_own on public.league_messages;
create policy league_messages_update_own on public.league_messages for update to authenticated using (author_id = (select auth.uid()) and created_at > now() - interval '15 minutes') with check (author_id = (select auth.uid()));
drop policy if exists league_messages_delete_own on public.league_messages;
create policy league_messages_delete_own on public.league_messages for delete to authenticated using (author_id = (select auth.uid()) and created_at > now() - interval '15 minutes');

drop policy if exists activity_events_read on public.activity_events;
create policy activity_events_read on public.activity_events for select to authenticated using (public.ff_is_member());

drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to authenticated using (public.ff_is_member());
drop policy if exists challenges_create on public.challenges;
create policy challenges_create on public.challenges for insert to authenticated with check (
  public.ff_is_member() and challenger_id = (select auth.uid()) and status = 'proposed'
  and exists (select 1 from public.teams where league_id = challenges.league_id and owner_id = challenges.opponent_id)
);
drop policy if exists challenges_respond on public.challenges;
create policy challenges_respond on public.challenges for update to authenticated using (opponent_id = (select auth.uid()) and status = 'proposed') with check (opponent_id = (select auth.uid()) and status in ('accepted','declined'));
drop policy if exists challenge_events_read on public.challenge_events;
create policy challenge_events_read on public.challenge_events for select to authenticated using (
  exists (select 1 from public.challenges c where c.id = challenge_id and public.ff_is_member())
);

create or replace function public.ff_guard_challenge_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'proposed' then
    raise exception 'accepted or completed challenge terms are immutable';
  end if;
  if new.title <> old.title or new.terms <> old.terms or new.stake_label <> old.stake_label
     or new.proposition_type <> old.proposition_type or new.challenger_id <> old.challenger_id
     or new.opponent_id <> old.opponent_id or new.league_id <> old.league_id then
    raise exception 'challenge terms cannot change after proposal';
  end if;
  if new.status not in ('accepted','declined') then raise exception 'invalid challenge transition'; end if;
  if new.status = 'accepted' then new.accepted_at := coalesce(new.accepted_at, now()); end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.ff_audit_challenge_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.challenge_events(challenge_id, actor_id, from_status, to_status, terms_hash)
  values (new.id, auth.uid(), case when tg_op = 'INSERT' then null else old.status end, new.status, new.terms_hash);
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.activity_events(league_id,event_type,headline,detail,actor_id,source_type,source_id)
    values(new.league_id,'challenge',case when new.status='accepted' then 'Challenge accepted' else 'Challenge updated' end,new.title,auth.uid(),'challenge',new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.ff_guard_challenge_update() from public, anon;
grant execute on function public.ff_guard_challenge_update() to authenticated;
revoke all on function public.ff_audit_challenge_change() from public, anon, authenticated;

drop trigger if exists guard_challenge_update on public.challenges;
create trigger guard_challenge_update before update on public.challenges for each row execute function public.ff_guard_challenge_update();
drop trigger if exists audit_challenge_change on public.challenges;
create trigger audit_challenge_change after insert or update on public.challenges for each row execute function public.ff_audit_challenge_change();

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.league_messages to authenticated;
grant select on public.activity_events to authenticated;
grant select, insert, update on public.challenges to authenticated;
grant select on public.challenge_events to authenticated;
revoke all on public.profiles, public.league_messages, public.activity_events, public.challenges, public.challenge_events from anon;

do $$ begin alter publication supabase_realtime add table public.league_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.challenges; exception when duplicate_object then null; end $$;
alter table public.league_messages replica identity full;
alter table public.challenges replica identity full;

insert into public.activity_events(league_id,event_type,headline,detail)
select id,'announcement','The clubhouse is open','League chat, live matchups, standings, and social challenges are ready.' from public.leagues
where not exists (select 1 from public.activity_events where headline='The clubhouse is open');
