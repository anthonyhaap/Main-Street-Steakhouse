"use client";

import { useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import type { Wire, WireArticle, WireInjury } from "@/lib/nfl/types";

/**
 * The wire, read from our own tables.
 *
 * It used to be a route handler that fetched ESPN on every request. Now
 * `pg_cron` loads both feeds into `nfl_news` and `nfl_injuries` every fifteen
 * minutes, which means this is two ordinary selects — and therefore gets the
 * same live contract as everything else on the page: realtime nudges, refetch
 * on focus, a polling safety net.
 *
 * The injuries table resolves `player_id` at load time, so matching a report to
 * a roster is a join rather than a guess. The old client had to match on an
 * ESPN athlete id that the injury feed never actually returned.
 */
export function useWire(enabled = true) {
  const fetcher = useCallback(async (): Promise<Wire> => {
    const supabase = supabaseBrowser();
    const [news, injuries] = await Promise.all([
      supabase.from("nfl_news").select("*")
        .order("published_at", { ascending: false, nullsFirst: false }).limit(60),
      supabase.from("nfl_injuries").select("*")
        .neq("severity", "probable").limit(1200),
    ]);

    const articles = (news.data ?? []) as WireArticle[];
    const hurt = (injuries.data ?? []) as WireInjury[];

    return {
      articles,
      injuries: hurt,
      fetchedAt: articles[0]?.published_at ?? null,
    };
  }, []);

  return useLive<Wire>(fetcher, {
    tables: ["nfl_news", "nfl_injuries"],
    channel: "nfl-wire",
    pollMs: 300000,
    enabled,
  });
}

/** Index a wire by the player it concerns. */
export function injuriesByPlayer(wire: Wire | null): Map<string, WireInjury> {
  const map = new Map<string, WireInjury>();
  for (const i of wire?.injuries ?? []) if (i.player_id) map.set(i.player_id, i);
  return map;
}
