-- ============================================================================
-- Take back the table writes nobody meant to grant.
--
-- 20260905144124 did this for functions. This is the same trap one object class
-- over, and it has been true of every table in this project since the first
-- migration.
--
-- A Supabase project carries
--
--   alter default privileges in schema public grant all on tables
--     to postgres, anon, authenticated, service_role
--
-- so `create table` hands INSERT, UPDATE and DELETE to `authenticated` before
-- any policy exists. The house style — `revoke all ... from public, anon`, then
-- `grant select ... to authenticated` — never takes those three back, because a
-- GRANT SELECT does not remove anything.
--
-- Thirty-four tables were in that state. To be exact about the severity: NONE
-- of it was exploitable. RLS is enabled on all of them and not one carries an
-- INSERT, UPDATE or DELETE policy, so every such write was refused by the row
-- policy regardless of the grant. The grant sat in front of a door that was
-- already locked.
--
-- It is worth closing anyway, for the reason the function version was worth
-- closing: the app's whole security model is "writes happen inside SECURITY
-- DEFINER functions that check things". A table-level write grant is a second,
-- undocumented way in that happens to be blocked today by a policy somebody
-- could reasonably add a permissive version of tomorrow. Two locks that agree
-- are worth more than one lock and an accident.
--
-- `profiles` is the one table meant to be written directly — a manager creates
-- and edits his own row — so its INSERT and UPDATE grants stay. Its DELETE does
-- not: there is no delete policy and never was, so that grant could not have
-- done anything, and nothing in the app removes a profile. Found by the general
-- assertion described below rather than by reading the list, which is exactly
-- the argument for having written the assertion.
--
-- The harness could not see any of this, in the same way it could not see the
-- function grants: scripts/replay/preflight.sql now installs the table default
-- privileges too, and supabase/tests/grants.sql asserts that no table carries a
-- write grant it has no policy for — so the next table to be added is caught
-- before it ships rather than by reading pg_class afterwards.
-- ============================================================================

revoke insert, update, delete on table
  public.activity_events,
  public.challenge_events,
  public.draft_picks,
  public.draft_queue,
  public.drafts,
  public.historical_standings,
  public.league_history,
  public.league_recaps,
  public.league_scoring_rules,
  public.leagues,
  public.matchups,
  public.nfl_games,
  public.nfl_injuries,
  public.nfl_news,
  public.nfl_teams,
  public.notification_outbox,
  public.notification_prefs,
  public.player_adp,
  public.player_id_map,
  public.player_projections,
  public.player_season_projections,
  public.player_stat_lines,
  public.players,
  public.push_subscriptions,
  public.reactions,
  public.rosters,
  public.teams,
  public.trade_block,
  public.trade_items,
  public.trades,
  public.transaction_items,
  public.transactions,
  public.waiver_claims,
  public.waiver_runs
from anon, authenticated;

revoke delete on table public.profiles from anon, authenticated;
