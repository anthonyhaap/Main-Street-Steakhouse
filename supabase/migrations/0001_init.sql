-- ============================================================================
-- Gridiron League — invite-only fantasy football platform
-- Initial schema + Row Level Security
-- ============================================================================

-- Roles a member can hold within a single league.
create type public.member_role as enum ('commissioner', 'owner', 'viewer');

-- Lifecycle of an emailed invite.
create type public.invite_status as enum ('pending', 'accepted', 'expired', 'revoked');

-- ----------------------------------------------------------------------------
-- profiles : public identity for an auth user. Email lives in auth.users; the
-- username here is the public fantasy handle.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique,
  full_name   text,
  created_at  timestamptz not null default now(),
  constraint username_format check (char_length(username) between 3 and 30)
);

-- ----------------------------------------------------------------------------
-- leagues
-- ----------------------------------------------------------------------------
create table public.leagues (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  season           text,
  commissioner_id  uuid not null references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- fantasy_teams : the rosters/slots within a league. owner_id is null until a
-- team is assigned to an accepted owner.
-- ----------------------------------------------------------------------------
create table public.fantasy_teams (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues (id) on delete cascade,
  name        text not null,
  owner_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (league_id, name)
);

-- ----------------------------------------------------------------------------
-- league_members : which users belong to which league, and their role.
-- ----------------------------------------------------------------------------
create table public.league_members (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.member_role not null default 'owner',
  team_id     uuid references public.fantasy_teams (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (league_id, user_id)
);

-- ----------------------------------------------------------------------------
-- league_invites : an emailed, tokenized invitation to join a league.
-- ----------------------------------------------------------------------------
create table public.league_invites (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues (id) on delete cascade,
  email       text not null,
  role        public.member_role not null default 'owner',
  team_id     uuid references public.fantasy_teams (id) on delete set null,
  token       text not null unique,
  status      public.invite_status not null default 'pending',
  expires_at  timestamptz not null,
  invited_by  uuid not null references public.profiles (id) on delete cascade,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Only one outstanding (pending) invite per email per league.
create unique index league_invites_unique_pending
  on public.league_invites (league_id, lower(email))
  where status = 'pending';

create index league_members_user_idx on public.league_members (user_id);
create index league_members_league_idx on public.league_members (league_id);
create index fantasy_teams_league_idx on public.fantasy_teams (league_id);
create index league_invites_league_idx on public.league_invites (league_id);

-- ============================================================================
-- Helper functions (SECURITY DEFINER) — used inside RLS policies to avoid
-- recursive policy evaluation on league_members.
-- ============================================================================

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.league_members m
    where m.league_id = p_league_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_league_commissioner(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.league_members m
    where m.league_id = p_league_id
      and m.user_id = auth.uid()
      and m.role = 'commissioner'
  );
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles       enable row level security;
alter table public.leagues        enable row level security;
alter table public.fantasy_teams  enable row level security;
alter table public.league_members enable row level security;
alter table public.league_invites enable row level security;

-- ---- profiles --------------------------------------------------------------
-- A user can always read and edit their own profile.
create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

-- A user can read profiles of people who share a league with them.
create policy "profiles: read co-members"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.league_members me
      join public.league_members them
        on them.league_id = me.league_id
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
    )
  );

create policy "profiles: insert own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- leagues ---------------------------------------------------------------
create policy "leagues: members read"
  on public.leagues for select
  using (public.is_league_member(id));

-- Any authenticated user may create a league (they become commissioner).
create policy "leagues: authenticated insert"
  on public.leagues for insert
  with check (commissioner_id = auth.uid());

create policy "leagues: commissioner update"
  on public.leagues for update
  using (public.is_league_commissioner(id))
  with check (public.is_league_commissioner(id));

create policy "leagues: commissioner delete"
  on public.leagues for delete
  using (public.is_league_commissioner(id));

-- ---- fantasy_teams ---------------------------------------------------------
create policy "teams: members read"
  on public.fantasy_teams for select
  using (public.is_league_member(league_id));

create policy "teams: commissioner insert"
  on public.fantasy_teams for insert
  with check (
    public.is_league_commissioner(league_id)
    or exists (
      select 1 from public.leagues l
      where l.id = league_id and l.commissioner_id = auth.uid()
    )
  );

-- A commissioner may edit any team; an owner may edit only their own team.
create policy "teams: commissioner or owner update"
  on public.fantasy_teams for update
  using (
    public.is_league_commissioner(league_id)
    or owner_id = auth.uid()
  )
  with check (
    public.is_league_commissioner(league_id)
    or owner_id = auth.uid()
  );

create policy "teams: commissioner delete"
  on public.fantasy_teams for delete
  using (public.is_league_commissioner(league_id));

-- ---- league_members --------------------------------------------------------
create policy "members: read same league"
  on public.league_members for select
  using (public.is_league_member(league_id));

-- Commissioners add members; the league creator may also bootstrap their own
-- commissioner membership row (before any membership exists yet).
create policy "members: commissioner insert"
  on public.league_members for insert
  with check (
    public.is_league_commissioner(league_id)
    or exists (
      select 1 from public.leagues l
      where l.id = league_id and l.commissioner_id = auth.uid()
    )
  );

create policy "members: commissioner update"
  on public.league_members for update
  using (public.is_league_commissioner(league_id))
  with check (public.is_league_commissioner(league_id));

-- A commissioner may remove members; a member may remove (leave) themselves.
create policy "members: commissioner or self delete"
  on public.league_members for delete
  using (
    public.is_league_commissioner(league_id)
    or user_id = auth.uid()
  );

-- ---- league_invites --------------------------------------------------------
-- Only commissioners manage invites through the user-scoped client. Token-based
-- validation during acceptance is handled server-side with the service role.
create policy "invites: commissioner read"
  on public.league_invites for select
  using (public.is_league_commissioner(league_id));

create policy "invites: commissioner insert"
  on public.league_invites for insert
  with check (public.is_league_commissioner(league_id));

create policy "invites: commissioner update"
  on public.league_invites for update
  using (public.is_league_commissioner(league_id))
  with check (public.is_league_commissioner(league_id));

create policy "invites: commissioner delete"
  on public.league_invites for delete
  using (public.is_league_commissioner(league_id));
