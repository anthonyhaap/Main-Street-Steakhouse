import { changesLead } from "./recap";
import type { SundayEvent } from "./sunday";

/**
 * A manager's Sundays, and a rivalry's, from the events the detector kept.
 *
 * The wall's Sunday lines (`ff_sunday_history`) count what a manager did. A
 * profile wants the other half too — the leads he lost, the comebacks made on
 * him — and a rivalry wants only the afternoons the two of them shared. Both
 * are the same rows read from a different chair, so they are read here, on the
 * client, from one fetch (`loadCareerEvents`), rather than asked of the
 * database a third way. Nothing is inferred: a manager with no stored events
 * has no line, and the card says nothing rather than a row of zeros.
 */

/** One stored event, with the week it belongs to. */
export type CareerEvent = Pick<SundayEvent,
  "id" | "type" | "level" | "team_id" | "opponent_team_id" | "matchup_id" | "lead_change" | "headline" | "detail" | "created_at"
> & { season: number; week: number };

/** The kinds a career is read from; the loader asks for these and any play that changed a lead. */
export const CAREER_TYPES = ["lead_change", "comeback", "monster_game"] as const;

export type Swing = { season: number; week: number; down: number; who: string; opp: string };
export type Monster = { season: number; week: number; player: string; points: number; who: string };

export type SundayLine = {
  /** Sundays with anything stored about him. */
  sundays: number;
  /** Leads taken, leads lost, and leads taken late (the detector's own `late` flag on the event). */
  took: number;
  lost: number;
  late: number;
  /** Comebacks he made, and comebacks made on him; deepest first. */
  comebacks: Swing[];
  blown: Swing[];
  /** His monster games, biggest first. */
  monsters: Monster[];
};

const weekKey = (e: CareerEvent) => `${e.season}:${e.week}`;
const num = (v: unknown) => Number(v ?? 0);
const swing = (e: CareerEvent): Swing => ({
  season: e.season, week: e.week, down: num(e.detail.down),
  who: String(e.detail.who ?? ""), opp: String(e.detail.opp ?? ""),
});
const monster = (e: CareerEvent): Monster => ({
  season: e.season, week: e.week, points: num(e.detail.points),
  // "Jared Goff — monster game": the player is the headline's first half.
  player: e.headline.split(" — ")[0], who: String(e.detail.who ?? ""),
});
const deepest = (a: Swing, b: Swing) => b.down - a.down;
const biggest = (a: Monster, b: Monster) => b.points - a.points;

export function sundayLine(events: CareerEvent[], teamId: string | null | undefined): SundayLine | null {
  if (!teamId) return null;
  const mine = events.filter((e) => e.team_id === teamId || e.opponent_team_id === teamId);
  if (mine.length === 0) return null;
  const leads = mine.filter(changesLead);
  return {
    sundays: new Set(mine.map(weekKey)).size,
    took: leads.filter((e) => e.team_id === teamId).length,
    lost: leads.filter((e) => e.opponent_team_id === teamId).length,
    late: leads.filter((e) => e.team_id === teamId && e.detail.late === true).length,
    comebacks: mine.filter((e) => e.type === "comeback" && e.team_id === teamId).map(swing).sort(deepest),
    blown: mine.filter((e) => e.type === "comeback" && e.opponent_team_id === teamId).map(swing).sort(deepest),
    monsters: mine.filter((e) => e.type === "monster_game" && e.team_id === teamId).map(monster).sort(biggest),
  };
}

export type RivalrySundays = {
  /** Sundays the two have shared with anything stored about it. */
  meetings: number;
  leadChanges: number;
  comebacks: Swing[];
  monsters: Monster[];
};

/** The afternoons two teams spent across the table from each other. */
export function rivalrySundays(events: CareerEvent[], a: string, b: string): RivalrySundays | null {
  const between = (e: CareerEvent) =>
    (e.team_id === a && e.opponent_team_id === b) || (e.team_id === b && e.opponent_team_id === a);
  const shared = events.filter(between);
  if (shared.length === 0) return null;
  return {
    meetings: new Set(shared.map(weekKey)).size,
    leadChanges: shared.filter(changesLead).length,
    comebacks: shared.filter((e) => e.type === "comeback").map(swing).sort(deepest),
    monsters: shared.filter((e) => e.type === "monster_game").map(monster).sort(biggest),
  };
}
