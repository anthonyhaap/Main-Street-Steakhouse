import type { Challenge, Outlook, OutlookTeam, Reaction } from "./types";
import { stakeText } from "./settlement";

/**
 * The recap page's arithmetic, kept pure so /preview/recap can render every
 * card from a fixture and tests/e2e/recap.spec.ts can hold it still.
 */

/** One row of league_recaps, as the page reads it. */
export type RecapRow = { week: number; body: string; created_at: string; message_id: string | null };

/** ff_personal_recap_line: the sentence that was pushed. */
export type RecapLine = { title: string; body: string };

export type WireCount = { kind: string; label: string; count: number };

export type SettledBet = { id: string; title: string; status: Challenge["status"]; winner: string; amount: string | null };

export type RecapReactions = Reaction[];

/**
 * The outlook as it stood at the end of a week: matchups after it unplayed,
 * every record and score recomputed from what remains. `powerRankings` reads
 * movement as the latest played week against the one before, so this is all
 * a past week's table needs.
 */
export function recapWeekOutlook(o: Outlook, week: number): Outlook {
  const matchups = o.matchups.map((m) =>
    m.week <= week ? m : { ...m, played: false, home_points: 0, away_points: 0 });
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const teams: OutlookTeam[] = o.teams.map((t) => {
    const mine = matchups.filter((m) => m.played && (m.home_team_id === t.id || m.away_team_id === t.id))
      .sort((a, b) => a.week - b.week);
    const scores = mine.map((m) => (m.home_team_id === t.id ? m.home_points : m.away_points));
    const against = mine.map((m) => (m.home_team_id === t.id ? m.away_points : m.home_points));
    const sum = (xs: number[]) => r1(xs.reduce((s, x) => s + x, 0));
    return {
      ...t,
      wins: scores.filter((s, k) => s > against[k]).length,
      losses: scores.filter((s, k) => s < against[k]).length,
      ties: scores.filter((s, k) => s === against[k]).length,
      points_for: sum(scores), points_against: sum(against), scores,
    };
  });
  return { ...o, week: week + 1, teams, matchups };
}

const WIRE_LABEL: Record<string, string> = {
  add: "signings", drop: "drops", add_drop: "add/drops", waiver: "waiver claims", trade: "trades",
};

/** How the wire moved that week, as counts by kind, busiest first. */
export function wireCounts(rows: { kind: string }[]): WireCount[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.kind, (by.get(r.kind) ?? 0) + 1);
  return Array.from(by, ([kind, count]) => ({ kind, label: WIRE_LABEL[kind] ?? kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * The bets the week decided: resolved in the seven days up to the moment the
 * Special was written, which is the week it was written about. Publication is
 * the upper bound — a bet ruled on afterwards belongs to the next week's
 * column, not retroactively to this one.
 */
export function settledThisWeek(
  challenges: Pick<Challenge, "id" | "title" | "status" | "winner_id" | "resolved_at" | "stake_amount_cents">[],
  recapCreatedAt: string,
  nameOf: (userId: string | null) => string,
): SettledBet[] {
  const end = new Date(recapCreatedAt).getTime();
  const start = end - 7 * 864e5;
  return challenges
    .filter((c) => c.resolved_at && c.winner_id)
    .filter((c) => { const t = new Date(c.resolved_at!).getTime(); return t >= start && t <= end; })
    .map((c) => ({ id: c.id, title: c.title, status: c.status, winner: nameOf(c.winner_id), amount: stakeText(c.stake_amount_cents) }));
}

/** The column, with its address under it, for the share sheet. */
export function recapShareText(recap: RecapRow, origin: string): string {
  return `${recap.body}\n\n${origin}/recap/${recap.week}`;
}

/** "The Weekly Special · Week 3" → 3, from the column's own first line. */
export function recapHeading(recap: RecapRow): string {
  return recap.body.split("\n")[0] || `The Weekly Special · Week ${recap.week}`;
}
