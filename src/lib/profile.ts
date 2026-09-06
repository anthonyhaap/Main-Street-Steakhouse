/**
 * A manager's career, assembled from what the wall already knows.
 *
 * The wall renders a card per manager — titles, record, a ring for each
 * championship — and then stops. There is nowhere to go from it. Every number
 * behind that card already comes down with `ff_history` and the historical
 * standings the page fetches beside it: who won what, who finished where, and
 * the whole twelve-by-twelve head-to-head grid. It was all on the client and
 * none of it was reachable.
 *
 * So this is pure derivation. No new RPC, no new table, nothing added to the
 * database — the profile is a second reading of a payload that was already on
 * the screen. It also means the profile cannot disagree with the wall above
 * it, because there is only one set of numbers.
 *
 * The head-to-head lines come from the same `grid` the rivalry card is checked
 * against in supabase/tests/rivalry.sql, so "Mike owns you" here and "you are
 * 2-11 against Mike" on the matchup card are the same claim.
 */

import type {
  HistoricalStanding, History, HistoryCell, HistoryManager,
} from "@/lib/history";

export type Trophy = {
  kind: "title" | "runner_up" | "regular_crown" | "spoon" | "record";
  label: string;
  years: number[];
  /** Whether it is one to be proud of. The spoon is not. */
  good: boolean;
};

export type SeasonLine = {
  season: number;
  finish: number | null;
  of: number | null;
  team_name: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points_for: number | null;
  /** Won the title that year, lost the final, or neither. */
  outcome: "champion" | "runner_up" | null;
};

export type HeadToHead = {
  opponent: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
};

export type ManagerProfile = {
  manager: HistoryManager;
  trophies: Trophy[];
  seasons: SeasonLine[];
  /** Every opponent they have played, most-played first. */
  h2h: HeadToHead[];
  /** The one they own, and the one that owns them. Null until enough games. */
  owns: HeadToHead | null;
  owned_by: HeadToHead | null;
  /** Their longest run of wins, if it is one the wall recorded. */
  best_run: History["streaks"][number] | null;
  /** Their highest single week, if it is one of the league's best. */
  league_high: History["highs"][number] | null;
};

/** How many meetings before "owns" is a claim rather than a coincidence. */
const OWNERSHIP_MIN = 4;

/**
 * ESPN records co-managed teams as one string. Split it rather than comparing
 * whole, or a manager who once shared a team disappears from his own career.
 */
const namesIn = (s: string | null): string[] =>
  (s ?? "").split(/[,/&]|\band\b/).map((x) => x.trim()).filter(Boolean);

export function buildProfile(
  history: History,
  standings: HistoricalStanding[],
  manager: string,
): ManagerProfile | null {
  const m = history.managers.find((x) => x.manager === manager);
  if (!m) return null;

  /* ------------------------------------------------------- the seasons -- */

  const bySeason = new Map<number, HistoricalStanding[]>();
  for (const row of standings) {
    bySeason.set(row.season, [...(bySeason.get(row.season) ?? []), row]);
  }

  const seasons: SeasonLine[] = [];
  for (const [season, rows] of bySeason) {
    const mine = rows.find((r) => namesIn(r.manager_names).includes(manager));
    if (!mine) continue;
    const meta = history.seasons.find((s) => s.season === season);
    // A season ESPN imported with every team at 0-0 has a rank of 0, which is
    // not a finish. Show the season, not a placing that was never played for.
    const ranked = rows.filter((r) => (r.final_rank ?? 0) > 0);
    seasons.push({
      season,
      finish: (mine.final_rank ?? 0) > 0 ? mine.final_rank : null,
      of: ranked.length || null,
      team_name: mine.team_name,
      wins: mine.wins, losses: mine.losses, ties: mine.ties,
      points_for: mine.points_for,
      outcome: meta?.champion === manager ? "champion"
        : meta?.runner_up === manager ? "runner_up"
        : null,
    });
  }
  seasons.sort((a, b) => b.season - a.season);

  /* ------------------------------------------------------ the cabinet -- */

  const trophies: Trophy[] = [];

  if (m.title_years.length > 0) {
    trophies.push({
      kind: "title", good: true, years: [...m.title_years].sort((a, b) => a - b),
      label: m.title_years.length === 1 ? "Champion" : `Champion x${m.title_years.length}`,
    });
  }

  const lostFinals = history.seasons
    .filter((s) => s.runner_up === manager)
    .map((s) => s.season)
    .sort((a, b) => a - b);
  if (lostFinals.length > 0) {
    trophies.push({
      kind: "runner_up", good: false, years: lostFinals,
      label: lostFinals.length === 1 ? "Lost the final" : `Lost ${lostFinals.length} finals`,
    });
  }

  // Top of the regular-season table. A different thing from the title, and in
  // most leagues the more annoying one to have and not convert.
  const crowns = seasons.filter((s) => s.finish === 1).map((s) => s.season).sort((a, b) => a - b);
  if (crowns.length > 0) {
    trophies.push({
      kind: "regular_crown", good: true, years: crowns,
      label: crowns.length === 1 ? "Best record" : `Best record x${crowns.length}`,
    });
  }

  const spoons = seasons
    .filter((s) => s.finish !== null && s.of !== null && s.finish === s.of)
    .map((s) => s.season).sort((a, b) => a - b);
  if (spoons.length > 0) {
    trophies.push({
      kind: "spoon", good: false, years: spoons,
      label: spoons.length === 1 ? "Wooden spoon" : `Wooden spoon x${spoons.length}`,
    });
  }

  const high = history.highs.find((h) => h.manager === manager) ?? null;
  // Only the league's outright best week is a trophy; being fourth-highest
  // once is a statistic.
  const leagueBest = history.highs[0]?.manager === manager ? history.highs[0] : null;
  if (leagueBest) {
    trophies.push({
      kind: "record", good: true, years: [leagueBest.season],
      label: `League record week, ${Number(leagueBest.points).toFixed(1)}`,
    });
  }

  /* --------------------------------------------------------- the grid -- */

  const h2h: HeadToHead[] = history.grid
    .filter((c: HistoryCell) => c.manager === manager)
    .map((c) => ({
      opponent: c.opponent,
      wins: c.wins, losses: c.losses, ties: c.ties,
      games: c.wins + c.losses + c.ties,
    }))
    .filter((c) => c.games > 0)
    .sort((a, b) => b.games - a.games || a.opponent.localeCompare(b.opponent));

  const eligible = h2h.filter((c) => c.games >= OWNERSHIP_MIN);
  const rate = (c: HeadToHead) => (c.wins + c.ties / 2) / c.games;
  const best = eligible.reduce<HeadToHead | null>(
    (a, b) => (a === null || rate(b) > rate(a) || (rate(b) === rate(a) && b.games > a.games) ? b : a), null);
  const worst = eligible.reduce<HeadToHead | null>(
    (a, b) => (a === null || rate(b) < rate(a) || (rate(b) === rate(a) && b.games > a.games) ? b : a), null);

  return {
    manager: m,
    trophies,
    seasons,
    h2h,
    // A pairing is only worth naming as lopsided if it is actually lopsided,
    // and the same pairing must never be both.
    owns: best && rate(best) > 0.5 ? best : null,
    owned_by: worst && rate(worst) < 0.5 && worst.opponent !== best?.opponent ? worst : null,
    best_run: history.streaks.find((s) => s.manager === manager) ?? null,
    league_high: high,
  };
}

/** "9-3" / "9-3-1". */
export const recordOf = (c: { wins: number; losses: number; ties: number }) =>
  `${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ""}`;
