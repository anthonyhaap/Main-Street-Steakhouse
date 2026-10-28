/**
 * Against the spread.
 *
 * A spread bet is an NFL game, a side and a line: the challenger takes one
 * team at a number, the opponent the other team at the opposite number. The
 * database writes the terms and decides the bet (ff_create_spread_challenge,
 * ff_resolve_spread_challenges); this is the same arithmetic for the screen,
 * so a card can say who is covering while the game is still on.
 *
 * `home_spread` is ESPN's line from the home side: -3.5 means the home team
 * gives three and a half.
 */

export type SpreadGame = {
  id: string;
  week: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  status: string | null;
  status_detail: string | null;
  home_score: number | null;
  away_score: number | null;
  home_spread: number | null;
};

/** The columns a SpreadGame is read with. */
export const SPREAD_GAME_COLUMNS =
  "id,week,home_team,away_team,kickoff_at,status,status_detail,home_score,away_score,home_spread";

/** "-3.5", "+3", "PK". The minus is a real one, for print. */
export function lineText(line: number): string {
  if (line === 0) return "PK";
  const n = Math.abs(line);
  return `${line > 0 ? "+" : "−"}${Number.isInteger(n) ? n : n.toFixed(1)}`;
}

/** "KC −3.5". */
export const spreadText = (team: string, line: number) => `${team} ${lineText(line)}`;

/** The other side of the game. */
export const otherTeam = (game: Pick<SpreadGame, "home_team" | "away_team">, team: string) =>
  team === game.home_team ? game.away_team : game.home_team;

/** ESPN's line on one side of a game, or null when there is none. */
export function marketLine(game: SpreadGame, team: string): number | null {
  if (game.home_spread == null) return null;
  const home = Number(game.home_spread);
  return team === game.home_team ? home : -home;
}

/** Can a bet on this game still be made or taken? The kickoff is the lock. */
export const isOpen = (game: Pick<SpreadGame, "kickoff_at" | "status">, now = Date.now()) =>
  game.status === "pre" && !!game.kickoff_at && new Date(game.kickoff_at).getTime() > now;

/**
 * The side's margin plus its line: above zero it is covering, below it is
 * not, zero is a push. Null before there is a score.
 */
export function cover(game: SpreadGame, team: string, line: number): number | null {
  if (game.home_score == null || game.away_score == null || game.status === "pre") return null;
  const margin = team === game.home_team ? game.home_score - game.away_score : game.away_score - game.home_score;
  return margin + Number(line);
}

/** A line the database will take: a whole or half point, no more than 50. */
export const validLine = (line: number) =>
  Number.isFinite(line) && Math.abs(line) <= 50 && Number.isInteger(line * 2);
