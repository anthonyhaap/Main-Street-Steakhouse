-- ============================================================================
-- The two extensions everything else assumes.
--
-- `http` is how the loaders fetch Sleeper, nflverse and ESPN from inside the
-- database; `pg_cron` is how every scheduled job runs. Both were enabled by
-- hand on the live project before the first migration, so neither appeared in
-- the history — and a database built from this directory alone therefore died
-- at the first `cron.schedule`, which is exactly what a Supabase preview
-- branch does.
--
-- This is the one file whose version was chosen rather than assigned. It is
-- back-dated to sit ahead of `20260809015006_core_schema`, because a
-- prerequisite that runs after the thing that needs it is not a prerequisite.
-- The statements are `if not exists`, so on the live project this is a strict
-- no-op — it was executed there and changed nothing — and on an empty database
-- it is the line that makes the rest replay.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
