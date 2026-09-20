"use client";

import { createContext, useCallback, useContext } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { UnreadCounts } from "@/lib/types";

/**
 * "12 new since your last visit," everywhere that needs it: the nav badge and
 * the homepage teaser both read from this one call rather than keeping their
 * own idea of what "unread" means.
 *
 * One subscription for the whole app, not one per reader. The nav badge (every
 * page) and the Tonight page's Overheard card both want this at once, and each
 * calling its own `useLive` used to open two Supabase Realtime channels named
 * "unread" on the same page — the same topic joined twice on one socket, which
 * flaps between SUBSCRIBED and CLOSED as each one's (re)join steps on the
 * other's, refetching in a loop the whole time. A context makes the mount and
 * the subscription happen exactly once.
 */
const UnreadCtx = createContext<UnreadCounts | null>(null);

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const { ready } = useSession();

  const fetcher = useCallback(async (): Promise<UnreadCounts> => {
    const { data, error } = await supabaseBrowser()
      .rpc("ff_unread_counts", { p_league_id: LEAGUE_ID });
    if (error) throw new Error(error.message);
    return data as UnreadCounts;
  }, []);

  const { data } = useLive<UnreadCounts>(fetcher, {
    tables: ["league_messages", "activity_events"],
    channel: "unread",
    pollMs: 30000,
    enabled: ready,
  });

  return <UnreadCtx.Provider value={data}>{children}</UnreadCtx.Provider>;
}

export const useUnreadCounts = () => useContext(UnreadCtx);

/** Call when a manager actually views Chat or the League Feed, to zero its badge. */
export async function markSeen(surface: "chat" | "league_feed") {
  await supabaseBrowser().rpc("ff_mark_seen", { p_league_id: LEAGUE_ID, p_surface: surface });
}
