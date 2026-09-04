/**
 * The scoreboard, in words and odds.
 *
 * `ff_scoreboard` hands the browser every table in the week with both lineups
 * on it: what each starter has scored, what he is projected to score, whether
 * his game has kicked, whether it is on right now. This file turns that into
 * the things that make a Sunday worth watching — a projected final, a win
 * probability, who is still to play, who is carrying the day, and the one
 * sentence that says where the game stands.
 *
 * Every function is pure. The same payload and the same clock always produce
 * the same card, which is what lets `/preview/matchups` render a whole
 * Sunday from one fixture and lets a test assert the sentence.
 */

import { LEAGUE_TZ } from "@/lib/config";

/* ----------------------------------------------------------------- types -- */
/** Shape of ff_scoreboard(league_id, week). */

export type ScoreStarter = {
  player_id: string;
  full_name: string;
  position: string;
  nfl_team: string | null;
  slot: string;
  espn_id: string | null;
  points: number;
  projection: number | null;
  kickoff_at: string | null;
  /** ESPN's: "pre" | "in" | "post". Null when he has no game this week. */
  game_status: string | null;
  /** ESPN's own words: "Final", "Q3 4:21", "Sun 1:00 PM ET". */
  game_detail: string | null;
  opponent: string | null;
  at_home: boolean | null;
  severity: string | null;
  on_bye: boolean;
  /** His game is over, or he never had one. */
  final: boolean;
};

export type ScoreTop = {
  full_name: string;
  position: string;
  nfl_team: string | null;
  points: number;
  game_status: string | null;
} | null;

export type ScoreSide = {
  team_id: string;
  name: string;
  manager_name: string | null;
  logo_path: string | null;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  /** Every starter's projection, whether or not he has played. */
  proj: number;
  /** Projection from starters whose game has not kicked. */
  proj_left: number;
  yet_to_play: number;
  in_action: number;
  empty_slots: number;
  top: ScoreTop;
  starters: ScoreStarter[];
  mine: boolean;
};

export type ScoreCard = {
  id: string;
  week: number;
  mine: boolean;
  home: ScoreSide;
  away: ScoreSide;
};

export type Slate = {
  week: number;
  first_kick: string | null;
  last_kick: string | null;
  total: number;
  final: number;
  in_progress: number;
  next_kickoff: string | null;
};

export type Scoreboard = {
  league: {
    id: string;
    name: string;
    season: number;
    team_count: number;
    regular_season_weeks: number;
    roster_slots: string[];
  };
  week: number;
  my_team_id: string | null;
  games: Slate;
  matchups: ScoreCard[];
  /** When a stat line for this week was last written, and a projection. */
  stats_updated_at: string | null;
  projections_updated_at: string | null;
  now: string;
  generated_at: string;
};

/* ----------------------------------------------------------------- state -- */

/**
 * What a card is doing right now.
 *
 *   pre      nobody on either side has kicked
 *   live     at least one starter's game is on
 *   settled  both lineups are done for the week
 *   between  games have been played, none are on: Sunday evening, Monday
 */
export type CardState = "pre" | "live" | "settled" | "between";

export function cardState(c: ScoreCard): CardState {
  const left = c.home.yet_to_play + c.away.yet_to_play;
  const on = c.home.in_action + c.away.in_action;
  const played = starters(c).some((s) => s.final && s.kickoff_at !== null);
  if (on > 0) return "live";
  if (left === 0) return played || starters(c).length > 0 ? "settled" : "pre";
  return played ? "between" : "pre";
}

const starters = (c: ScoreCard) => [...c.home.starters, ...c.away.starters];

/**
 * What a side has still to come.
 *
 * `proj_left` off the wire counts only starters who have not kicked, which is
 * the right number for a Thursday and the wrong one at four o'clock: a back
 * six points into a fourteen-point afternoon would be carrying nothing. So a
 * man already playing contributes the part of his projection he has not
 * reached yet. He can beat it — the number then simply stops moving for him,
 * which is the conservative direction for a projection to be wrong in.
 */
export function remainingProjection(s: ScoreSide): number {
  return round1(
    s.starters.reduce((acc, p) => {
      if (p.final) return acc;
      const proj = Number(p.projection ?? 0);
      return acc + (p.game_status === "in" ? Math.max(0, proj - Number(p.points)) : proj);
    }, 0),
  );
}

/** What a side will finish on if every projection is right from here. */
export function projectedFinal(s: ScoreSide): number {
  // A week with no lineup rows at all: take what the wire already summed.
  if (s.starters.length === 0) return round1(Number(s.points) + Number(s.proj_left));
  return round1(Number(s.points) + remainingProjection(s));
}

/** How far ahead of — or behind — its own projection a side is running. */
export const versusProjection = (s: ScoreSide) => round1(projectedFinal(s) - Number(s.proj));

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------- win odds -- */

/**
 * A live win probability, from the margin a card is projected to finish on and
 * how much football is left to disturb it.
 *
 * The model is deliberately the simple one, and the screen says so: each
 * starter still to play is treated as an independent swing whose standard
 * deviation is 65% of his projection, floored at five points — a kicker can
 * lose you a week too. A starter whose game is already on has spent about half
 * of that uncertainty, so half is what he still carries. The margin over the
 * total spread goes through the normal CDF.
 *
 * It is not a simulation of the NFL. It is an honest reading of "how much can
 * still change", which is the question a manager is actually asking at 4pm,
 * and it collapses to a certainty the moment the last game ends.
 */
const SD_FLOOR = 5;
const SD_SHARE = 0.65;

export function sideSigma(s: ScoreSide): number {
  const v = s.starters.reduce((acc, p) => {
    if (p.final) return acc;
    const sd = Math.max(SD_FLOOR, SD_SHARE * Number(p.projection ?? 0));
    // Already playing: roughly half the week's variance is spent.
    const live = p.game_status === "in" ? 0.5 : 1;
    return acc + Math.pow(sd * live, 2);
  }, 0);
  return Math.sqrt(v);
}

export type WinOdds = {
  /** Probability the home side wins, 0–100. */
  home: number;
  away: number;
  /** True once no football can change the result. */
  settled: boolean;
};

export function winOdds(c: ScoreCard): WinOdds {
  const margin = projectedFinal(c.home) - projectedFinal(c.away);
  const sigma = Math.hypot(sideSigma(c.home), sideSigma(c.away));

  if (sigma < 0.5) {
    const home = margin > 0 ? 100 : margin < 0 ? 0 : 50;
    return { home, away: 100 - home, settled: true };
  }
  const home = clamp(phi(margin / sigma) * 100);
  return { home, away: 100 - home, settled: false };
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Normal CDF, Abramowitz & Stegun 7.1.26. Plenty for a scoreboard. */
function phi(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * A percentage nobody can read as a promise. The sim behind it cannot tell 0
 * from 0.4, so the extremes are printed as bounds — the same rule the
 * standings board uses for playoff odds.
 */
export function pctLabel(p: number): string {
  const r = Math.round(p);
  if (r <= 0) return "<1%";
  if (r >= 100) return ">99%";
  return `${r}%`;
}

/* ------------------------------------------------------------- language -- */

export const fmt1 = (n: number | string | null | undefined) => Number(n ?? 0).toFixed(1);

/** "Dave" if the commissioner typed a name; the team otherwise. */
export const who = (s: { manager_name: string | null; name: string }) =>
  s.manager_name?.trim().split(/\s+/)[0] || s.name;

const lastName = (full: string) => full.trim().split(/\s+/).slice(-1)[0];

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const words = (n: number) => WORDS[n] ?? String(n);

/** "three left", "one left". */
const left = (n: number) => `${words(n)} left`;

/**
 * Where the game stands, in one sentence, written from `me`'s side of it.
 *
 * The shapes come in the order a Sunday produces them: nothing kicked, both
 * sides mid-slate, one man left against nobody — which is the line people
 * screenshot — and finally the settled card.
 */
export function cardLine(c: ScoreCard, myTeamId: string | null): string {
  const mine = myTeamId === c.home.team_id ? c.home : myTeamId === c.away.team_id ? c.away : null;
  const me = mine ?? c.home;
  const them = mine ? (mine === c.home ? c.away : c.home) : c.away;
  const first = mine ? "You" : who(me);
  const theirs = who(them);

  const diff = round1(Number(me.points) - Number(them.points));
  const gap = Math.abs(diff).toFixed(1);
  const up = diff > 0;
  const myLeft = me.starters.filter((s) => !s.final);
  const theirLeft = them.starters.filter((s) => !s.final);
  const state = cardState(c);

  if (state === "pre") {
    if (me.starters.length + them.starters.length === 0) {
      return "Lineups post once the draft is done.";
    }
    if (me.proj + them.proj === 0) return "No projections on file for this week yet.";
    const edge = round1(Number(me.proj) - Number(them.proj));
    const lead = Math.abs(edge).toFixed(1);
    if (Math.abs(edge) < 3) return "Projected inside three points. Coin flip.";
    return edge > 0
      ? `${first} project${mine ? "" : "s"} ${lead} clear of ${theirs}.`
      : `${theirs} projects ${lead} clear of ${mine ? "you" : first}.`;
  }

  if (myLeft.length === 0 && theirLeft.length === 0) {
    if (diff === 0) return `Dead heat, ${fmt1(me.points)} apiece.`;
    return up ? `${first} took it by ${gap}.` : `${theirs} took it by ${gap}.`;
  }

  // The Monday-night line: one man against an empty bench.
  if (myLeft.length === 1 && theirLeft.length === 0) {
    const p = myLeft[0];
    const name = lastName(p.full_name);
    if (!up) return `${first} need${mine ? "" : "s"} ${(-diff + 0.1).toFixed(1)} from ${name}. He's projected ${fmt1(p.projection)}.`;
    return `${first} ${mine ? "are" : "is"} up ${gap} with ${name} still to play. ${theirs} is done.`;
  }
  if (myLeft.length === 0 && theirLeft.length === 1) {
    const p = theirLeft[0];
    const name = lastName(p.full_name);
    if (up) return `${theirs} needs ${(diff + 0.1).toFixed(1)} from ${name}, projected ${fmt1(p.projection)}.`;
    return `${theirs} leads by ${gap} with ${name} still to come.`;
  }
  if (myLeft.length === 1 && theirLeft.length === 1) {
    return `${lastName(myLeft[0].full_name)} against ${lastName(theirLeft[0].full_name)} decides it. ${first} ${mine ? "are" : "is"} ${up ? "up" : "down"} ${gap}.`;
  }

  const on = me.in_action + them.in_action;
  const tail = on === 0 ? " Nothing on right now." : "";
  if (diff === 0) return `All square, ${left(myLeft.length)} against ${words(theirLeft.length)}.${tail}`;
  return `${first} ${mine ? "are" : "is"} ${up ? "up" : "down"} ${gap}, ${left(myLeft.length)} against ${words(theirLeft.length)}.${tail}`;
}

/**
 * The one line under the week's number: how much football is left to play.
 * On a quiet Wednesday it counts down to the next kickoff instead.
 */
export function slateLine(g: Slate, now: number): string {
  if (!g || g.total === 0) return "No NFL games on file for this week.";
  if (g.in_progress > 0) {
    const toCome = g.total - g.final - g.in_progress;
    return `${g.in_progress} game${g.in_progress === 1 ? "" : "s"} on now${toCome > 0 ? `, ${toCome} still to kick` : ""}.`;
  }
  if (g.final >= g.total) return "Every game is final. The week is in the books.";
  if (g.next_kickoff) return `${g.total - g.final} game${g.total - g.final === 1 ? "" : "s"} to come · next kickoff ${until(g.next_kickoff, now)}.`;
  return `${g.total - g.final} game${g.total - g.final === 1 ? "" : "s"} left to play.`;
}

/** "in 2h 14m", "in 3 days", "now". */
export function until(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

/**
 * How old the numbers are. The point is not precision — it is that a manager
 * looking at a score that has not moved in ten minutes can tell whether the
 * game is quiet or the wire is.
 */
export function freshness(iso: string | null | undefined, now: number): string {
  if (!iso) return "not yet scored";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "not yet scored";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "seconds ago";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * The marker on a starter's row: where his real game is. ESPN's own words when
 * it has them, because "Q3 4:21" is worth more than anything paraphrased.
 */
export function gameMark(s: ScoreStarter, now: number): { label: string; state: "live" | "final" | "pre" | "none" } {
  if (s.on_bye) return { label: "BYE", state: "none" };
  if (!s.kickoff_at && !s.game_status) return { label: "—", state: "none" };
  if (s.game_status === "in") return { label: s.game_detail || "Live", state: "live" };
  if (s.game_status === "post") return { label: "Final", state: "final" };
  const vs = s.opponent ? `${s.at_home ? "vs" : "@"} ${s.opponent} · ` : "";
  return { label: `${vs}${kickLabel(s.kickoff_at, now)}`, state: "pre" };
}

/** "Sun 1:00", or "in 42m" once it is close enough to matter. */
export function kickLabel(iso: string | null, now: number, tz = LEAGUE_TZ): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - now;
  if (ms > 0 && ms < 3 * 3600_000) return until(iso, now);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * The one starter worth naming on a side: whoever has scored the most, once
 * anyone has scored at all. Before kickoff nobody has, and a "top performer"
 * reading 0.0 is worse than no line.
 */
export function topPerformer(s: ScoreSide): ScoreTop {
  if (!s.top || Number(s.top.points) <= 0) return null;
  return s.top;
}

/** The starters still to come, in kickoff order — the "who's left" list. */
export function stillToPlay(s: ScoreSide): ScoreStarter[] {
  return s.starters
    .filter((p) => !p.final)
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""));
}

/**
 * A lineup with a hole in it on a Sunday is the loudest thing on the page — but
 * a team with no roster at all is a league that has not drafted, not a manager
 * who forgot, and flagging twelve of those in red says nothing.
 */
export const hasProblem = (s: ScoreSide) =>
  s.starters.length > 0
  && (s.empty_slots > 0 || s.starters.some((p) => p.on_bye || p.severity === "out"));
