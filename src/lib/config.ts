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

/**
 * Where the league lives. The home screen changes personality by day of the
 * week — Tuesday is a recap, Wednesday is waivers, Sunday is a scoreboard —
 * and that day is decided here, not on whichever phone is asking. A manager
 * checking scores from a hotel in Denver still sees the league's Tuesday.
 */
export const LEAGUE_TZ = "America/New_York";

/** Where share links point. Set once; the group chat unfurls against it. */
export const SITE_URL = "https://steakhouse.football";

/**
 * When the draft starts, as an instant.
 *
 * The `drafts` row has `started_at` — when the commissioner actually pressed
 * the button — and nothing for when she said she would. So the room could tell
 * you it had not started and could not tell you when it would, which is the one
 * question anybody has on the afternoon of draft day. It lived in a group chat.
 *
 * Stored in UTC on purpose. The league was told "7:30 Central", and on
 * September 8th Central is CDT (UTC-5), so that instant is 00:30Z the next day
 * — an hour off if you take "CST" at its word in September. Writing the moment
 * rather than the wall clock is what makes the countdown agree with every
 * phone in the league, wherever it is.
 *
 * A constant rather than a column because it is one evening, once, and a
 * schema change here cannot be applied until it has been reviewed and merged —
 * which is longer than the draft is away. To move it: change the value and
 * redeploy. To retire it after the draft: set it to null and the countdown
 * disappears everywhere it appears.
 */
export const DRAFT_STARTS_AT: string | null = "2026-09-09T00:30:00Z";

/** The time as the league was told it, for the label under the count. */
export const DRAFT_START_LABEL = "7:30 PM CT";
