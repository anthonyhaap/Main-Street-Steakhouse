"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LEAGUE_ID } from "@/lib/config";

/**
 * "Wed, Sep 16, 8:00 AM" rather than a countdown: a ticking clock on a weekly
 * deadline is anxiety, not information. One formatter, so the desk, the wire
 * and the pool all name the same moment the same way.
 */
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

/**
 * When the wire next settles, for screens that are not the wire.
 *
 * The board itself carries `settles_at`, but a manager reading his desk should
 * not have to open the transaction centre to learn what day claims run. This is
 * the one function the board uses for it, `ff_next_waiver_run`, asked directly:
 * a league setting and the clock, nothing about any team, so it is cheap and it
 * is the same answer the wire gives.
 *
 * Fetched once per mount rather than kept live. The settlement moves once a
 * week, at the settlement, and a desk left open across it will be a week stale
 * about a deadline that has passed — which the wire itself corrects the moment
 * it is opened.
 */
export function useWaiverDeadline(enabled = true): string | null {
  const [at, setAt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void supabaseBrowser()
      .rpc("ff_next_waiver_run", { p_league_id: LEAGUE_ID })
      .then(({ data }) => { if (alive && typeof data === "string") setAt(data); });
    return () => { alive = false; };
  }, [enabled]);

  return at;
}
