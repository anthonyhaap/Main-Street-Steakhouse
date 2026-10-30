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
import type { NflGame, SundayBoard, SundayEvent } from "@/lib/sunday";
import { STORY_TYPES } from "@/lib/recap";
import { CAREER_TYPES, type CareerEvent } from "@/lib/sundayline";

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

type EventRow = {
  id: string; event_type: SundayEvent["type"]; level: SundayEvent["level"]; priority: number;
  matchup_id: string | null; team_id: string | null; opponent_team_id: string | null;
  player_id: string | null; nfl_game_id: string | null; points_added: number | null;
  old_score: number | null; new_score: number | null; opp_old_score: number | null; opp_new_score: number | null;
  lead_change: boolean; headline: string; description: string | null;
  detail: SundayEvent["detail"] | null; created_at: string;
};

/**
 * Rows straight off `sunday_events`, for a screen that does not read
 * `ff_sunday`. Members may read the table; the player's name is in the
 * headline, so nothing is joined. A database without the table, or any
 * failure, is an empty story rather than a broken page.
 */
const EVENT_COLUMNS = "id, event_type, level, priority, matchup_id, team_id, opponent_team_id, player_id, nfl_game_id, points_added, old_score, new_score, opp_old_score, opp_new_score, lead_change, headline, description, detail, created_at";

const toEvent = ({ event_type, detail, ...r }: EventRow): SundayEvent => ({
  ...r, type: event_type, detail: detail ?? {}, player_name: null, espn_id: null,
});

/**
 * The part of a finished week the recap tells (`weekStory`): its finals, every
 * play that changed a lead, and its comebacks, monster games and season highs.
 * Asked for by kind rather than as the newest few hundred, because a busy
 * Sunday writes hundreds of scoring rows and the lead changes that matter
 * most are the oldest. Same failure rule as above.
 */
export async function loadWeekStory(sb: SupabaseClient, season: number, week: number): Promise<SundayEvent[]> {
  const { data, error } = await sb
    .from("sunday_events")
    .select(EVENT_COLUMNS)
    .eq("league_id", LEAGUE_ID).eq("season", season).eq("week", week)
    .or(`event_type.in.(${STORY_TYPES.join(",")}),lead_change.eq.true`)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error || !data) return [];
  return (data as EventRow[]).map(toEvent);
}

/**
 * Every lead change, comeback and monster game the league has stored, for the
 * profiles and the rivalries (`sundayLine`, `rivalrySundays`). Asked for by
 * kind, all seasons, oldest first, a page at a time: a few hundred rows a
 * season, and PostgREST stops a single answer at its row cap (a thousand by
 * default) without saying so, so one big `limit` would quietly turn an
 * all-time record into its first few seasons. Same failure rule as above: no
 * table, or any error, is no Sundays.
 */
const CAREER_PAGE = 1000;

export async function loadCareerEvents(sb: SupabaseClient): Promise<CareerEvent[]> {
  type Row = Omit<CareerEvent, "type" | "detail"> & { event_type: CareerEvent["type"]; detail: CareerEvent["detail"] | null };
  const out: CareerEvent[] = [];
  for (let from = 0; ; from += CAREER_PAGE) {
    const { data, error } = await sb
      .from("sunday_events")
      .select("id, season, week, event_type, level, team_id, opponent_team_id, matchup_id, lead_change, headline, detail, created_at")
      .eq("league_id", LEAGUE_ID)
      .or(`event_type.in.(${CAREER_TYPES.join(",")}),lead_change.eq.true`)
      // id breaks created_at ties, so a page boundary never skips or repeats a row.
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + CAREER_PAGE - 1);
    if (error || !data) return [];
    for (const { event_type, detail, ...r } of data as Row[]) out.push({ ...r, type: event_type, detail: detail ?? {} });
    if (data.length < CAREER_PAGE) return out;
  }
}
