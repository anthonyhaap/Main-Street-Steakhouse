import { supabaseServer } from "@/lib/supabase/server";
import { LEAGUE_ID } from "@/lib/config";
import type { Briefing } from "@/lib/briefing";
import { Tonight } from "@/components/tonight/Tonight";

/**
 * Tonight's Table, rendered on the server.
 *
 * The briefing is one RPC on the session cookie, so the HTML that arrives
 * already says "Week 3 · You vs. Dave" — no skeleton, no spinner, no second
 * round trip before the first meaningful paint. The client component takes
 * it from there under the live contract.
 *
 * A signed-in account that is not yet on a team (first visit, before
 * `ff_link_me` has bound it) gets nothing here on purpose; the session
 * provider links it in the browser and the client fetch follows.
 */
export default async function Page() {
  const supabase = await supabaseServer();

  // No `auth.getUser()` here. `src/proxy.ts` runs before this on every matched
  // path and has already redirected anyone without a session to /login, so by
  // the time this function runs a user is established. Asking again was a
  // second round trip to the auth server — in series, before a single byte of
  // HTML went out — for an answer the request had already been given.
  //
  // The unlinked case is unchanged: an account with no team is not a member,
  // ff_briefing refuses it, and `initial` stays null exactly as before.
  const { data, error } = await supabase.rpc("ff_briefing", { p_league_id: LEAGUE_ID });
  const initial: Briefing | null = !error && data ? (data as Briefing) : null;

  // The database's clock, not this container's: it is the one the card was
  // written against, and the one every draft clock in the app already trusts.
  return <Tonight initial={initial} serverNow={initial ? new Date(initial.now).getTime() : 0} />;
}
