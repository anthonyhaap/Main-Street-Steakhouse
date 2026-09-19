"use client";

import { useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { LEAGUE_ID } from "@/lib/config";
import type { UnreadCounts } from "@/lib/types";

/**
 * "12 new since your last visit," everywhere that needs it: the nav badge and
 * the homepage teaser both read from this one call rather than keeping their
 * own idea of what "unread" means.
 */
export function useUnreadCounts(enabled: boolean) {
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
    enabled,
  });

  return data;
}

/** Call when a manager actually views Chat or the League Feed, to zero its badge. */
export async function markSeen(surface: "chat" | "league_feed") {
  await supabaseBrowser().rpc("ff_mark_seen", { p_league_id: LEAGUE_ID, p_surface: surface });
}
