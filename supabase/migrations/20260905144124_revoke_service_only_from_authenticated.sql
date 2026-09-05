-- ============================================================================
-- Take back EXECUTE on the functions that were never meant to be a manager's
-- to call.
--
-- Every migration in this repo revokes a new function `from public, anon` and
-- then grants back only what the screens need. That was one role short. This
-- project carries
--
--   alter default privileges in schema public grant execute on functions
--     to postgres, anon, authenticated, service_role
--
-- (two of them: one from supabase_admin, one from postgres), so EVERY function
-- created here was granted to `authenticated` the moment it existed. Revoking
-- `from public, anon` took the anon grant back and left the authenticated one
-- standing. The `grant ... to authenticated` lines that follow were, for these
-- functions, never the thing that decided anything.
--
-- The throwaway Postgres the replay harness builds has no such default
-- privileges, so it showed the intended grants and the check passed. The
-- harness is being taught this in the same change (scripts/replay/preflight.sql),
-- along with a test that asserts it, so the next one is caught before it ships
-- rather than by reading pg_proc afterwards.
--
-- Worst of these by some distance is ff_run_waivers: any signed-in manager
-- could settle the league's waivers at a moment of his choosing, which is the
-- exact thing the comment above its grant says is not a manager's call.
--
-- Nothing in src/ calls any of these — they are cron entries, loaders, and
-- helpers that SECURITY DEFINER functions call internally, where the definer's
-- own rights apply and this revoke changes nothing.
-- ============================================================================

revoke execute on function public.ff_run_waivers(uuid, integer)          from authenticated;
revoke execute on function public.ff_process_waivers()                   from authenticated;
revoke execute on function public.ff_place_unordered_teams(uuid)         from authenticated;
revoke execute on function public.ff_validate_trade(uuid,uuid,uuid,uuid[],uuid[],integer) from authenticated;

revoke execute on function public.ff_roll_rosters()                      from authenticated;
revoke execute on function public.ff_materialize_roster(uuid, integer)   from authenticated;
revoke execute on function public.ff_refresh_wire()                      from authenticated;
revoke execute on function public.ff_refresh_projections()               from authenticated;
revoke execute on function public.ff_rebuild_season_projections(integer) from authenticated;
revoke execute on function public.ff_load_season_projections()           from authenticated;
revoke execute on function public.ff_load_sleeper_projections(integer, integer, text) from authenticated;
revoke execute on function public.ff_load_espn_injuries()                from authenticated;
revoke execute on function public.ff_load_espn_news(integer)             from authenticated;
revoke execute on function public.ff_backfill_bye_weeks(integer)         from authenticated;

revoke execute on function public.ff_player_season(uuid, integer, jsonb) from authenticated;
revoke execute on function public.ff_recap_body(jsonb)                   from authenticated;
revoke execute on function public.ff_injury_severity(text)               from authenticated;
revoke execute on function public.ff_height_inches(text)                 from authenticated;
revoke execute on function public.ff_club(text)                          from authenticated;
revoke execute on function public.ff_who(text, text)                     from authenticated;
