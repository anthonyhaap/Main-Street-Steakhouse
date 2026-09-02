-- ============================================================================
-- A login that can read the migration ledger and nothing else.
--
-- .github/workflows/migrations.yml verifies that every file in
-- supabase/migrations/ names a version this database has actually recorded.
-- Without a database URL it can only compare the migrations directory to a
-- ledger committed beside it — two files in the same pull request, which one
-- consistent mistake satisfies.
--
-- Closing that needs a credential in CI, and the obvious credential is the
-- postgres superuser. That is a poor trade: full production access, sitting in
-- a GitHub secret, to run one SELECT against one table. This role is that one
-- SELECT and nothing more.
--
-- It is created WITHOUT a password, so it cannot authenticate and grants
-- nobody anything until someone sets one in the dashboard. Creating it is
-- inert; enabling it is a deliberate act.
--
-- To undo: drop owned by ci_migrations_reader; drop role ci_migrations_reader;
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ci_migrations_reader') then
    -- No password clause on purpose. Supabase requires SCRAM for external
    -- connections, so a passwordless role cannot log in at all.
    create role ci_migrations_reader with login;
  end if;
end $$;

-- SUPERUSER, BYPASSRLS and REPLICATION are absent rather than spelled out as
-- NO...: altering them requires a superuser, which `postgres` is not on
-- Supabase. Their defaults are already off, and the fact that nothing here can
-- turn them on is a stronger guarantee than restating them would be.
alter role ci_migrations_reader
  nocreatedb nocreaterole noinherit connection limit 4;

-- RLS still applies to this role everywhere, and it holds no policy anywhere,
-- so the two grants below are the whole of its reach. schema_migrations itself
-- has no RLS, which is why the grant is what governs it.
grant usage on schema supabase_migrations to ci_migrations_reader;
grant select on supabase_migrations.schema_migrations to ci_migrations_reader;

-- Deliberately not granted: anything in public, any other table in
-- supabase_migrations, and any future table in either. A check that reads a
-- list of version strings needs no more than the list of version strings.

comment on role ci_migrations_reader is
  'CI only. Reads supabase_migrations.schema_migrations so the migrations workflow can verify filenames against recorded history. No password until one is set by hand.';
