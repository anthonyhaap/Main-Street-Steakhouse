"use client";

/**
 * Is any NFL game on right now? — for the nav's LIVE dot.
 *
 * The calendar is the wrong question: Sunday at nine in the morning is not
 * live, and Thursday night is. `nfl_games.status` is the right one, and cron
 * already keeps it current. One head-only count, shared by every mount of
 * the shell through a module-level cache, so navigating between six pages
 * costs one request, not six; refreshed every two minutes while the tab is
 * visible and on return to it. Any failure — signed out, offline — reads as
 * "not live", which is the quiet direction for a dot to be wrong in.
 */

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const EVERY = 120_000;
let cache: { at: number; live: boolean } | null = null;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<(v: boolean) => void>();

async function ask(): Promise<boolean> {
  if (cache && Date.now() - cache.at < EVERY / 2) return cache.live;
  inflight ??= (async () => {
    try {
      const { count, error } = await supabaseBrowser()
        .from("nfl_games").select("id", { count: "exact", head: true })
        .eq("status", "in").eq("season_type", 2);
      return !error && (count ?? 0) > 0;
    } catch {
      return false;
    }
  })().then((live) => {
    cache = { at: Date.now(), live };
    inflight = null;
    listeners.forEach((f) => f(live));
    return live;
  });
  return inflight;
}

export function useNflLive(): boolean {
  // Every mount after the first starts from what the last one learned.
  const [live, setLive] = useState(() => cache?.live ?? false);
  useEffect(() => {
    listeners.add(setLive);
    const tick = () => { if (document.visibilityState === "visible") void ask(); };
    tick();
    const id = setInterval(tick, EVERY);
    document.addEventListener("visibilitychange", tick);
    return () => {
      listeners.delete(setLive);
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return live;
}
