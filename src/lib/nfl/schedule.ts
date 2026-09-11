"use client";

import { useCallback, useId } from "react";
import { SEASON } from "@/lib/config";
import { useLive } from "@/lib/live";
import { normTeam } from "@/lib/nfl/teams";
import type { HubGame } from "@/lib/nfl/types";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Who every club plays this week, keyed by our abbreviation.
 *
 * The team hub and the scoreboard already know a starter's opponent, because
 * the RPC behind each of them joins `nfl_games` on the way out. The player
 * pool, the wire and the trade desk read lighter payloads that stop at the
 * club — and a club is only half of the question a manager asks before he
 * signs, claims or trades for somebody. This is the other half: one read of
 * the week's slate, 16 rows or so, folded into a map the row components can
 * look a player up in.
 *
 * A club missing from the map is on its bye. The current week is derived from
 * `nfl_games` itself, so its slate is never absent — only incomplete for a
 * future week the loader has not reached yet.
 */
export type WeekGames = Map<string, HubGame>;

type GameRow = {
  home_team: string | null;
  away_team: string | null;
  kickoff_at: string | null;
  status: string | null;
  status_detail: string | null;
};

export function foldGames(rows: GameRow[]): WeekGames {
  const games: WeekGames = new Map();
  for (const g of rows) {
    const home = normTeam(g.home_team);
    const away = normTeam(g.away_team);
    if (!home || !away) continue;
    const shared = { kickoff_at: g.kickoff_at ?? "", status: g.status, status_detail: g.status_detail };
    games.set(home, { opponent: away, home: true, ...shared });
    games.set(away, { opponent: home, home: false, ...shared });
  }
  return games;
}

/** The regular-season slate for one week. Empty when nothing is loaded yet. */
export async function loadWeekGames(week: number): Promise<WeekGames> {
  const { data, error } = await supabaseBrowser()
    .from("nfl_games")
    .select("home_team, away_team, kickoff_at, status, status_detail")
    .eq("season", SEASON)
    .eq("season_type", 2)
    .eq("week", week);
  if (error) throw new Error(error.message);
  return foldGames((data ?? []) as GameRow[]);
}

/**
 * The week's slate, kept current the same way everything else is: fetched on
 * mount, again when `nfl_games` changes (the live poll rewrites status every
 * two minutes on a Sunday), and again on focus. Pass the week when the page
 * already knows it; leave it out and the current week is looked up.
 *
 * Returns null until the first read lands, so a row can tell "not loaded"
 * from "on bye" and print nothing rather than the wrong thing.
 */
export function useWeekGames(week?: number | null): { week: number | null; games: WeekGames | null } {
  const { ready } = useSession();
  // Realtime topics are per subscription: two panels asking for the same
  // week must not share a channel name, or one tears down the other's.
  const id = useId();

  const fetcher = useCallback(async () => {
    let w = week ?? null;
    if (w == null) {
      const { data, error } = await supabaseBrowser().rpc("ff_current_week");
      if (error) throw new Error(error.message);
      w = (data as number | null) ?? 1;
    }
    return { week: w, games: await loadWeekGames(w) };
  }, [week]);

  const { data } = useLive(fetcher, {
    tables: ["nfl_games"],
    channel: `week-games-${week ?? "current"}-${id}`,
    pollMs: 120000,
    enabled: ready && week !== null,
  });

  return { week: data?.week ?? week ?? null, games: data?.games ?? null };
}

/**
 * A player's game this week, from the club on his card.
 *
 *   undefined — the slate is not loaded, or he has no club (a free agent)
 *   null      — the slate is loaded and his club is not on it: a bye
 */
export function gameFor(games: WeekGames | null | undefined, nflTeam: string | null | undefined): HubGame | null | undefined {
  if (!games || games.size === 0) return undefined;
  const key = normTeam(nflTeam);
  if (!key) return undefined;
  return games.get(key) ?? null;
}
