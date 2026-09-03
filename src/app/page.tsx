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
  const { data: { user } } = await supabase.auth.getUser();

  let initial: Briefing | null = null;
  if (user) {
    const { data, error } = await supabase.rpc("ff_briefing", { p_league_id: LEAGUE_ID });
    if (!error && data) initial = data as Briefing;
  }

  // The database's clock, not this container's: it is the one the card was
  // written against, and the one every draft clock in the app already trusts.
  return <Tonight initial={initial} serverNow={initial ? new Date(initial.now).getTime() : 0} />;
}
