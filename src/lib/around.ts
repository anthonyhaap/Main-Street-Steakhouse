/**
 * Around the house — the whole league at once, while it is happening.
 *
 * The scoreboard answers "how is my game going". On a Sunday afternoon that is
 * the wrong question about eleven twelfths of the league: what a manager
 * actually does at four o'clock is flick between six cards looking for the one
 * thing worth watching, and the app made him do it by hand, one card at a time,
 * with the lineups collapsed.
 *
 * So this reads across all six cards instead of down one: every player on the
 * field right now, ranked; the games close enough to matter; and the men
 * beating or missing their projection by enough that somebody's afternoon is
 * turning on them.
 *
 * Pure derivation from the payload `/matchups` already has. `ff_scoreboard`
 * brings down every starter on every card with his points, his projection and
 * whether his game is on — so there is nothing to fetch, nothing to add to the
 * database, and no way for this screen to disagree with the cards it is
 * summarising.
 */

import type { ScoreCard, ScoreStarter, Scoreboard } from "@/lib/scoreboard";

/** A player on the field, and whose afternoon he is deciding. */
export type LivePlayer = {
  starter: ScoreStarter;
  /** The team that started him. */
  team_id: string;
  team_name: string;
  manager: string | null;
  mine: boolean;
  /** The matchup he is playing in, for the link through. */
  matchup_id: string;
  /** His side's margin right now. Negative means his side is behind. */
  margin: number;
  /** Points above (or below) what he was projected to have by now. */
  vs_projection: number | null;
};

export type CloseGame = {
  card: ScoreCard;
  margin: number;
  /** Starters still to play, both sides added together. */
  left: number;
  on: number;
};

const isLive = (s: ScoreStarter) => s.game_status === "in";

/**
 * Everyone on the field, across the league, best first.
 *
 * A projection is for a whole game, so comparing it against a score at half
 * time would call every player in the league a disappointment. `vs_projection`
 * is therefore only claimed once his game is over; while he is playing, the
 * number on screen is what he has actually scored.
 */
export function onNow(board: Scoreboard): LivePlayer[] {
  const out: LivePlayer[] = [];

  for (const card of board.matchups) {
    for (const side of [card.home, card.away]) {
      const other = side === card.home ? card.away : card.home;
      const margin = Number(side.points) - Number(other.points);

      for (const starter of side.starters) {
        if (!isLive(starter)) continue;
        out.push({
          starter,
          team_id: side.team_id,
          team_name: side.name,
          manager: side.manager_name,
          mine: side.mine,
          matchup_id: card.id,
          margin,
          vs_projection: null,
        });
      }
    }
  }

  return out.sort((a, b) =>
    Number(b.starter.points) - Number(a.starter.points)
    || a.starter.full_name.localeCompare(b.starter.full_name));
}

/**
 * The games worth looking at: still live, and close.
 *
 * "Close" is a margin under twenty, which is roughly one big play in a
 * full-point league — near enough that the next drive can turn it.
 */
export const CLOSE_MARGIN = 20;

export function closeGames(board: Scoreboard): CloseGame[] {
  return board.matchups
    .map((card) => ({
      card,
      margin: Math.abs(Number(card.home.points) - Number(card.away.points)),
      left: card.home.yet_to_play + card.away.yet_to_play,
      on: card.home.in_action + card.away.in_action,
    }))
    // A finished game is not close, however small the margin: nothing is going
    // to happen to it.
    .filter((g) => (g.left + g.on) > 0 && g.margin <= CLOSE_MARGIN)
    .sort((a, b) => a.margin - b.margin);
}

/**
 * Finished performances furthest from what was expected of them, either way.
 *
 * Only finished ones: a player on nine points at half time has not missed his
 * projection, he is halfway through it, and calling that a bust is the most
 * common lie a live fantasy screen tells.
 */
export function swings(board: Scoreboard, limit = 5): LivePlayer[] {
  const out: LivePlayer[] = [];

  for (const card of board.matchups) {
    for (const side of [card.home, card.away]) {
      const other = side === card.home ? card.away : card.home;
      const margin = Number(side.points) - Number(other.points);

      for (const starter of side.starters) {
        if (!starter.final || starter.on_bye) continue;
        if (starter.projection == null) continue;
        // He has to have had a game: a player who never kicked off is not a
        // performance, he is an empty slot.
        if (starter.game_status !== "post") continue;

        out.push({
          starter,
          team_id: side.team_id,
          team_name: side.name,
          manager: side.manager_name,
          mine: side.mine,
          matchup_id: card.id,
          margin,
          vs_projection: Number(starter.points) - Number(starter.projection),
        });
      }
    }
  }

  return out
    .filter((p) => Math.abs(p.vs_projection ?? 0) >= 5)
    .sort((a, b) => Math.abs(b.vs_projection ?? 0) - Math.abs(a.vs_projection ?? 0))
    .slice(0, limit);
}

/** How many of the league's starters are on the field right now. */
export const liveCount = (board: Scoreboard): number =>
  board.matchups.reduce((n, c) => n + c.home.in_action + c.away.in_action, 0);

/** "Dave" rather than "Dave Whitmore", and never a null. */
export const who = (p: { manager: string | null; team_name: string }) =>
  p.manager?.trim().split(/\s+/)[0] || p.team_name;

/**
 * The line at the top: what is actually going on, in one sentence, so a
 * manager knows whether this screen is worth staying on.
 */
export function houseLine(board: Scoreboard): string {
  const live = liveCount(board);
  const close = closeGames(board).length;

  if (live === 0) {
    const toKick = board.matchups.reduce((n, c) => n + c.home.yet_to_play + c.away.yet_to_play, 0);
    return toKick > 0
      ? `Nobody is on the field. ${toKick} starter${toKick === 1 ? "" : "s"} still to kick off.`
      : "Every game is over. Nothing left to watch.";
  }

  const players = `${live} player${live === 1 ? "" : "s"} on the field`;
  if (close === 0) return `${players}, and not one game inside ${CLOSE_MARGIN} points.`;
  return `${players}. ${close} game${close === 1 ? " is" : "s are"} inside ${CLOSE_MARGIN} points.`;
}
