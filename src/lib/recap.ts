import type { Challenge, Outlook, OutlookTeam, Reaction } from "./types";
import { stakeText } from "./settlement";
import type { SundayEvent } from "./sunday";

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

/* ------------------------------------------------------ how it happened -- */

/**
 * The column is written from final scores, and a final score is the one fact
 * about a Sunday that says nothing about it: 120.7–112.8 reads the same whether
 * it was never close or changed hands four times. The detector kept the rest
 * in `sunday_events` as it happened. This reads it back — nothing here is
 * inferred from the board, and a week from before the feed existed simply has
 * no story to tell.
 *
 *   games     each table's result as the detector wrote it, how many times the
 *             lead changed hands, and the change that stood: the last one,
 *             taken by the side that won
 *   moments   comebacks, monster games and season highs, in the order they
 *             came
 */
export type GameStory = {
  /** The matchup, or the final's own id once its matchup is gone (see `weekStory`). */
  key: string;
  matchupId: string | null;
  final: SundayEvent;
  leadChanges: number;
  decider: SundayEvent | null;
  mine: boolean;
};

export type WeekStory = { games: GameStory[]; moments: SundayEvent[]; leadChanges: number };

/** The kinds the story is told from. `loadWeekStory` asks for these, and for any play that changed a lead. */
export const STORY_TYPES = ["lead_change", "final", "comeback", "monster_game", "season_high"] as const;

const MOMENT_TYPES = new Set(["comeback", "monster_game", "season_high"]);

/**
 * A comeback rides on the lead change that explains it, and is told as a
 * moment rather than counted twice.
 */
const changesLead = (e: SundayEvent) => e.type === "lead_change" || (e.lead_change && e.type !== "comeback");

const at = (e: SundayEvent) => Date.parse(e.created_at);

export function weekStory(events: SundayEvent[], myTeamId: string | null | undefined): WeekStory | null {
  // Regenerating the schedule deletes the matchups and nulls `matchup_id` on
  // the events, which are kept. A final like that still has its headline and
  // teams, so it keeps its line, keyed by its own id; what it cannot keep is
  // the lead changes, which nothing ties to it any more.
  const finals = new Map<string, SundayEvent>();
  for (const e of events) {
    if (e.type !== "final") continue;
    const key = e.matchup_id ?? `event:${e.id}`;
    if (!finals.has(key)) finals.set(key, e);
  }

  const involves = (e: SundayEvent) => !!myTeamId && (e.team_id === myTeamId || e.opponent_team_id === myTeamId);
  let total = 0;
  const games: GameStory[] = Array.from(finals, ([key, final]) => {
    const matchupId = final.matchup_id;
    const changes = events.filter((e) => matchupId && e.matchup_id === matchupId && changesLead(e) && at(e) <= at(final))
      .sort((x, y) => at(x) - at(y));
    total += changes.length;
    const last = changes[changes.length - 1] ?? null;
    const level = final.new_score != null && final.new_score === final.opp_new_score;
    // Only a change the winner made can be the one that stood. Without a winner
    // on the final (a dead heat, or an older row) there is no "stood" to tell.
    const decider = last && !level && final.team_id && last.team_id === final.team_id ? last : null;
    return { key, matchupId, final, leadChanges: changes.length, decider, mine: involves(final) };
  });
  games.sort((x, y) => Number(y.mine) - Number(x.mine) || y.leadChanges - x.leadChanges
    || Number(x.final.detail.margin ?? Infinity) - Number(y.final.detail.margin ?? Infinity)
    || x.final.headline.localeCompare(y.final.headline));

  const moments = events.filter((e) => MOMENT_TYPES.has(e.type)).sort((x, y) => at(x) - at(y));
  if (games.length === 0 && moments.length === 0) return null;
  return { games, moments, leadChanges: total };
}
