/**
 * Load the game center's payload, with or without its migration.
 *
 * `ff_sunday` arrives with `20260930201953_sunday_game_center`, and the
 * browser ships ahead of a migration being applied — this repository applies
 * migrations after they merge. A game center that refused to open until then
 * would be a blank page on the one day it matters, so when the function is not
 * there yet the page assembles the same payload from what is: `ff_scoreboard`
 * for the board, and the week's `nfl_games` rows (members may read them) for
 * the slate. Possession and the red zone are the only things missing from
 * that version, and every reader of them already treats "nobody has the ball"
 * as the normal case.
 *
 * Shared by the server render and the browser's refetch so the two can never
 * disagree about which road they took.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAGUE_ID } from "@/lib/config";
import type { Scoreboard } from "@/lib/scoreboard";
import type { NflGame, SundayBoard } from "@/lib/sunday";

/** PostgREST's "no such function", in either of the shapes it arrives in. */
function missingFunction(e: { code?: string; message?: string }): boolean {
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");
}

type GameRow = {
  id: string; home_team: string | null; away_team: string | null;
  home_score: number | null; away_score: number | null;
  kickoff_at: string | null; status: string | null; status_detail: string | null;
  home_spread: number | null; updated_at: string | null;
};

export async function loadSunday(sb: SupabaseClient, week: number | null): Promise<SundayBoard> {
  const direct = await sb.rpc("ff_sunday", { p_league_id: LEAGUE_ID, p_week: week });
  if (!direct.error && direct.data) return direct.data as SundayBoard;
  if (direct.error && !missingFunction(direct.error)) throw new Error(direct.error.message);

  const sbd = await sb.rpc("ff_scoreboard", { p_league_id: LEAGUE_ID, p_week: week });
  if (sbd.error) throw new Error(sbd.error.message);
  const board = sbd.data as Scoreboard;

  // The slate is the garnish, not the meal: if it cannot be read, the board
  // still opens with an empty NFL panel rather than not at all.
  const { data: rows } = await sb
    .from("nfl_games")
    .select("id, home_team, away_team, home_score, away_score, kickoff_at, status, status_detail, home_spread, updated_at")
    .eq("season", board.league.season)
    .eq("season_type", 2)
    .eq("week", board.week)
    .order("kickoff_at", { ascending: true, nullsFirst: false });

  const nfl: NflGame[] = ((rows ?? []) as GameRow[]).map((g) => ({
    id: g.id, home: g.home_team, away: g.away_team,
    home_score: g.home_score, away_score: g.away_score,
    kickoff_at: g.kickoff_at, status: g.status, detail: g.status_detail,
    home_spread: g.home_spread, possession: null, red_zone: false, down_distance: null,
    updated_at: g.updated_at,
  }));

  // No function, no event engine either: an empty feed, which the page reads
  // as "nothing has happened yet".
  return { ...board, nfl, events: [], activity: [] };
}
