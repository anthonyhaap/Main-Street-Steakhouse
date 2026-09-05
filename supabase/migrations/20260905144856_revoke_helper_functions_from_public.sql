-- ============================================================================
-- The other half of 20260905144124.
--
-- That migration revoked EXECUTE from `authenticated` on the functions no
-- manager should call. Six of them were still reachable afterwards, because
-- their grant was never to `authenticated` at all — it was to PUBLIC, which
-- every role inherits. Their original migrations never carried the house
-- `revoke ... from public, anon` line, so the Postgres default of "EXECUTE to
-- PUBLIC on a new function" was simply left standing.
--
-- Checking pg_proc for `authenticated=X` does not see this; the grant shows as
-- a bare `=X/postgres`. supabase/tests/grants.sql uses has_function_privilege
-- instead, which does, and is what found these.
--
-- All six take scalars and return scalars, none is SECURITY DEFINER, and
-- nothing outside the database calls them — so this is tightening a surface
-- rather than closing an exploit. The exploitable version of this shape is a
-- SECURITY DEFINER function reachable by anon, which is a real thing on this
-- project (ff_email_invited) and is deliberately NOT touched here: /join calls
-- it before anybody has signed in.
-- ============================================================================

revoke execute on function public.ff_player_season(uuid, integer, jsonb) from public;
revoke execute on function public.ff_recap_body(jsonb)                   from public;
revoke execute on function public.ff_injury_severity(text)               from public;
revoke execute on function public.ff_height_inches(text)                 from public;
revoke execute on function public.ff_club(text)                          from public;
revoke execute on function public.ff_who(text, text)                     from public;
