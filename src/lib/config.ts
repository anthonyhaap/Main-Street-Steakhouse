/**
 * Supabase connection details — deliberately hardcoded.
 *
 * These were previously read from NEXT_PUBLIC_* environment variables, and that
 * caused a real outage: the Vercel project still carried env vars from an
 * earlier build, so the deployed bundle shipped a URL and a key that did not
 * belong to the same project. GoTrue rejects a mismatched pair with the
 * unhelpful message "Invalid API key", and login broke for everyone.
 *
 * This app serves exactly one league on exactly one Supabase project, so there
 * is nothing to parameterise. Pinning the values here means what you read is
 * what ships, and no dashboard setting can silently override it.
 *
 * The publishable key is safe in client code by design: it carries no
 * privileges. Every table is RLS-protected, league tables require owning a team
 * (public.ff_is_member), and every write goes through a SECURITY DEFINER ff_*
 * function that re-checks auth.uid(). Anyone holding this key and nothing else
 * can read nothing and write nothing.
 *
 * To rotate: change the value here and redeploy. Do not reintroduce env vars
 * without deleting the stale ones on the Vercel project first.
 */
export const SUPABASE_URL = "https://ojhjrxolrsppircyrcff.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Nx2d2lz-N84EDNtMpaTXpw_dNFaeKqu";

/** The one league this deployment serves. */
export const LEAGUE_ID = "11111111-1111-1111-1111-111111111111";
export const DRAFT_ID = "22222222-2222-2222-2222-222222222222";
export const SEASON = 2026;
