/**
 * Power rankings — the table with the schedule taken out of it.
 *
 * A won-lost record answers "what happened". It does not answer the question
 * every league actually argues about, which is "who is any good". Those come
 * apart because a fantasy schedule is drawn out of a hat: you can score the
 * second-most points in the league all year, draw the high scorer four times,
 * and sit sixth. The table calls that a bad season. It was a bad draw.
 *
 * So this ranks on ALL-PLAY: every week, every team's score against every
 * other team's score that same week. Eleven results a week instead of one,
 * and not one of them depends on who you were scheduled against. It is the
 * least clever measure available and that is the point — a power ranking
 * nobody can reproduce on the back of an envelope is astrology with a table
 * around it.
 *
 * Two deliberate choices:
 *
 * Weekly scores are read from `matchups`, which carry their week, and not
 * from `OutlookTeam.scores`, which is an array of played weeks with no week
 * on it. Those are the same list right up until one team has played a week
 * another has not, at which point comparing them by position compares two
 * different Sundays.
 *
 * Movement is recomputed, not remembered. Last week's ranking is this same
 * function run over every week but the last, so nothing has to be stored and
 * a corrected score fixes the arrows behind it.
 */

import type { Outlook, OutlookTeam } from "@/lib/types";
import { rankKey } from "@/lib/playoffs";

/** How many weeks count as "lately". */
export const RECENT_WEEKS = 3;

/**
 * How much of the ranking is the whole season and how much is lately. Whole
 * season carries it — a power ranking that swings on one Sunday is a
 * scoreboard — but form is real and a ranking that ignores it is a museum.
 */
export const SEASON_WEIGHT = 0.65;
export const RECENT_WEIGHT = 0.35;

export type PowerRow = {
  team_id: string;
  name: string;
  manager_name: string | null;
  rank: number;
  /** Rank as of last week, and the change. Null in the first week. */
  prev_rank: number | null;
  move: number | null;
  /** Record against the whole league, week by week. */
  ap_wins: number;
  ap_losses: number;
  ap_ties: number;
  /** All-play winning percentage, 0–1. */
  ap_pct: number;
  /** The same over the last few weeks. Equals `ap_pct` early on. */
  recent_pct: number;
  recent_wins: number;
  recent_losses: number;
  recent_ties: number;
  /** How many of the last weeks that record covers. */
  recent_weeks: number;
  /** The blend the ranking sorts on, 0–1. */
  score: number;
  wins: number;
  losses: number;
  ties: number;
  /** Actual wins minus what the all-play record earned. Signed. */
  luck: number;
  weeks: number;
  points_for: number;
  high: number | null;
  low: number | null;
};

/* --------------------------------------------------------------- weeks -- */

/**
 * Every played regular-season week, as week number → each team's score.
 * Playoff weeks are left out: a bracket is not a league-wide sample, and half
 * the league is not playing.
 */
export function weeklyScores(o: Outlook): Map<number, Map<string, number>> {
  const weeks = new Map<number, Map<string, number>>();
  for (const m of o.matchups) {
    if (!m.played || m.week > o.regular_season_weeks) continue;
    const row = weeks.get(m.week) ?? new Map<string, number>();
    row.set(m.home_team_id, Number(m.home_points));
    row.set(m.away_team_id, Number(m.away_points));
    weeks.set(m.week, row);
  }
  return weeks;
}

/** Whether there is anything to rank. One week is thin, but it is real. */
export function canRank(o: Outlook | null): boolean {
  return !!o && weeklyScores(o).size > 0;
}

/* ------------------------------------------------------------ the rank -- */

/**
 * `upTo` cuts the season short, which is how last week's table is produced.
 * Everything else is a straight count.
 */
function rank(o: Outlook, upTo?: number): PowerRow[] {
  const weeks = weeklyScores(o);
  const played = [...weeks.keys()]
    .filter((w) => upTo === undefined || w <= upTo)
    .sort((a, b) => a - b);
  const recentFrom = played[Math.max(0, played.length - RECENT_WEEKS)];

  const rows = o.teams.map((t) => {
    let apW = 0, apL = 0, apT = 0, rW = 0, rL = 0, rT = 0, n = 0, rn = 0;
    let high: number | null = null, low: number | null = null;

    for (const w of played) {
      const row = weeks.get(w)!;
      const mine = row.get(t.id);
      if (mine === undefined) continue;
      n++;
      if (w >= recentFrom) rn++;
      high = high === null ? mine : Math.max(high, mine);
      low = low === null ? mine : Math.min(low, mine);

      for (const [id, theirs] of row) {
        if (id === t.id) continue;
        const win = mine > theirs ? 1 : 0;
        const loss = mine < theirs ? 1 : 0;
        const tie = mine === theirs ? 1 : 0;
        apW += win; apL += loss; apT += tie;
        if (w >= recentFrom) { rW += win; rL += loss; rT += tie; }
      }
    }

    const pct = (w: number, l: number, d: number) => {
      const total = w + l + d;
      return total === 0 ? 0 : (w + d / 2) / total;
    };
    const ap_pct = pct(apW, apL, apT);
    const recent_pct = rW + rL + rT === 0 ? ap_pct : pct(rW, rL, rT);

    return {
      team_id: t.id,
      name: t.name,
      manager_name: t.manager_name,
      rank: 0,
      prev_rank: null as number | null,
      move: null as number | null,
      ap_wins: apW, ap_losses: apL, ap_ties: apT,
      ap_pct,
      recent_pct,
      recent_wins: rW, recent_losses: rL, recent_ties: rT, recent_weeks: rn,
      score: SEASON_WEIGHT * ap_pct + RECENT_WEIGHT * recent_pct,
      wins: Number(t.wins),
      losses: Number(t.losses),
      ties: Number(t.ties),
      // What the all-play record says the season was worth, against what the
      // table actually paid out. A tie is half a win on both sides of that.
      luck: rankKey(t) - ap_pct * n,
      weeks: n,
      points_for: Number(t.points_for),
      high, low,
    };
  });

  rows.sort(
    (a, b) =>
      b.score - a.score
      || b.ap_pct - a.ap_pct
      || b.points_for - a.points_for
      || a.name.localeCompare(b.name),
  );
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/**
 * The rankings, with last week's beside them.
 *
 * A team that has not played every week is ranked on the weeks it has: its
 * all-play percentage is a rate, so a missed week costs it nothing it did not
 * lose on the field.
 */
export function powerRankings(o: Outlook): PowerRow[] {
  const rows = rank(o);
  const weeks = [...weeklyScores(o).keys()].sort((a, b) => a - b);
  if (weeks.length < 2) return rows;

  const before = new Map(
    rank(o, weeks[weeks.length - 2]).map((r) => [r.team_id, r.rank]),
  );
  for (const r of rows) {
    r.prev_rank = before.get(r.team_id) ?? null;
    // Positive is upward: second place from fifth is a move of three.
    r.move = r.prev_rank === null ? null : r.prev_rank - r.rank;
  }
  return rows;
}

/**
 * Where a team sits in the actual table, so the two orders can be set against
 * each other. Sorted the way `StandingsBoard` sorts, because a page that
 * ranked the same league two ways and disagreed with itself about who is
 * fourth would be reporting a bug.
 */
export function tablePositions(o: Outlook): Map<string, number> {
  const sorted = [...o.teams].sort(
    (a: OutlookTeam, b: OutlookTeam) =>
      rankKey(b) - rankKey(a)
      || Number(b.points_for) - Number(a.points_for)
      || a.name.localeCompare(b.name),
  );
  return new Map(sorted.map((t, i) => [t.id, i + 1]));
}

/* ---------------------------------------------------------- the words -- */

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The line under a team's rank — the reason this screen exists rather than
 * the standings alone. Luck first when there is any, because a record that
 * has not been earned is the most interesting thing a ranking can say, and
 * the second most interesting is that it has.
 */
export function powerLine(r: PowerRow, mine: boolean): string {
  const who = mine ? "You are" : `${first(r.manager_name || r.name)} is`;
  const have = mine ? "you have" : "he has";
  const gap = Math.round(Math.abs(r.luck));

  if (r.luck >= 1.5) {
    return `${who} ${plural(gap, "win")} better off than ${have} played.`;
  }
  if (r.luck <= -1.5) {
    return `${who} ${plural(gap, "win")} worse off than ${have} played. The draw has done that.`;
  }
  if (r.move !== null && Math.abs(r.move) >= 3) {
    return r.move > 0
      ? `Up ${plural(r.move, "place")} on last week.`
      : `Down ${plural(-r.move, "place")} on last week.`;
  }
  // Nothing dramatic: say the thing the ranking is actually made of.
  return `All-play ${r.ap_wins}-${r.ap_losses}${r.ap_ties ? `-${r.ap_ties}` : ""}.`;
}

/**
 * The one sentence for the whole card: the widest gap in the league between
 * what somebody's record says and what his scores say. That is the argument
 * the rankings exist to start, so it is stated rather than left to be found
 * by reading twelve rows.
 */
export function powerHeadline(rows: PowerRow[], positions: Map<string, number>): string | null {
  if (rows.length === 0 || rows[0].weeks === 0) return null;
  const widest = rows.reduce((a, b) => (Math.abs(b.luck) > Math.abs(a.luck) ? b : a));
  if (Math.abs(widest.luck) < 1.5) return null;

  const pos = positions.get(widest.team_id);
  const name = first(widest.manager_name || widest.name);
  if (!pos) return null;

  return widest.luck > 0
    ? `${name} is ${ordinal(pos)} in the table and ${ordinal(widest.rank)} here. The schedule has been kind.`
    : `${name} is ${ordinal(widest.rank)} on the scores and ${ordinal(pos)} in the table. Nobody has drawn worse.`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
