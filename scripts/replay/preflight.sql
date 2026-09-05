-- ============================================================================
-- The database a Supabase branch hands to the first migration.
--
-- A preview branch is not an empty Postgres. Before `20260809014900` runs,
-- Supabase has already created the roles, the `auth` and `storage` schemas,
-- the `supabase_realtime` publication and the `extensions` schema that the
-- migrations write against. None of that is in supabase/migrations/, and none
-- of it should be — it is the platform, not the application.
--
-- This file is that platform, rebuilt on a local Postgres so the 66 files can
-- be replayed verbatim. It is deliberately the SMALLEST thing the migrations
-- actually touch (see scripts/replay-migrations.sh for how that surface was
-- measured), because every object invented here is an object the replay stops
-- being able to prove anything about.
--
-- NOT a migration. It never runs against a Supabase project, which already
-- has all of this.
-- ============================================================================

-- ------------------------------------------------------------------- roles --
-- `anon` and `authenticated` are the two the RLS policies and grants name.
-- `service_role` is granted to but never revoked from; `authenticator` and the
-- admin roles exist so role-membership statements resolve.
do $$
declare r text;
begin
  foreach r in array array[
    'anon', 'authenticated', 'service_role', 'authenticator',
    'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

-- -------------------------------------------------------------- extensions --
-- Supabase puts third-party extensions in `extensions`, not `public`, which is
-- why the migrations say `extensions.http_get` and set
-- `search_path = public, extensions`.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- --------------------------------------------------------------------- auth --
-- Only `auth.users(id)` and `auth.uid()` are referenced by the migrations
-- (89 calls to uid, 14 references to users), so only those are built. The
-- columns are the real ones for the shape a foreign key needs; `email` is
-- included because `ff_email_invited` reads it.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- The request's user, read out of the JWT claims GoTRUE sets per statement.
-- Locally there is no JWT, so this reads the same GUC and returns NULL, which
-- is exactly what an unauthenticated request gets on the real platform.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.role', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    ), ''
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- ------------------------------------------------------------------ storage --
-- `20260902150241_team_crests` inserts a bucket and writes four policies on
-- `storage.objects`. Both tables are the platform's; these are the columns
-- those statements name.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  path_tokens text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

grant select, insert, update, delete on storage.objects, storage.buckets
  to anon, authenticated, service_role;

-- ----------------------------------------------------------------- realtime --
-- Five migrations add tables to this publication. Supabase creates it empty on
-- every project; `for all tables` here would make the ADD statements fail, so
-- it is created with no members, exactly as the platform does.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ------------------------------------------------------- the migration ledger --
-- Supabase's own migration runner creates this and writes a row per file it
-- applies. `20260902020943_ci_migrations_reader` grants a CI role SELECT on it,
-- so it has to exist before that migration runs — on a branch it always does.
-- scripts/replay-migrations.sh writes to it as the runner would, which is what
-- lets the replay finish by checking its own history against the ledger.
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);
