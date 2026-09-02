/**
 * Playoff projections, simulated in the browser.
 *
 * The question a manager asks in week 9 is not "what is my record" but "am I
 * getting in". The honest answer is a probability, and the honest way to get
 * one is to play the rest of the season out a few thousand times.
 *
 * Each team's weekly score is drawn from a normal distribution. Its mean blends
 * what the team has actually scored with what its current starters are
 * projected to score, weighted so that a preseason projection is worth about
 * four games of evidence and fades as real results arrive. Its spread comes
 * from the team's own week-to-week swing once there is enough of it, and from
 * a typical fantasy variance until then.
 *
 * Every unplayed regular-season matchup is sampled, the table is sorted the
 * way the standings page sorts it, and the top N are in. Clinches and
 * eliminations are worked out separately and exactly, because "100%" from a
 * simulation is not the same claim as "it is mathematically settled".
 *
 * Pure: the only input is the outlook payload, and the random source is a
 * seeded generator so the same standings always produce the same numbers.
 * A page that flickered between 61% and 63% on every poll would teach people
 * to ignore it.
 */

import type { Outlook, OutlookTeam } from "@/lib/types";

export type PlayoffStatus = "clinched_bye" | "clinched" | "eliminated" | null;

export type PlayoffProjection = {
  team_id: string;
  /** Regular-season games this team has left. */
  remaining: number;
  proj_wins: number;
  proj_losses: number;
  /** Share of simulated seasons that ended in the playoffs, 0–100. */
  playoff_pct: number;
  /** Share that ended with a first-round bye, 0–100. */
  bye_pct: number;
  /** Share that ended as the top seed, 0–100. */
  top_seed_pct: number;
  avg_seed: number;
  status: PlayoffStatus;
};

/** A preseason projection counts for this many games of real results. */
const PRIOR_GAMES = 4;
/** Week-to-week swing as a share of the mean, before a team has its own. */
const SPREAD = 0.18;
const MIN_SD = 8;
const FALLBACK_PPG = 110;
/** Seasons played out per projection. Plenty for whole-percent odds. */
export const SIMS = 4000;

/** How the standings rank teams: a tie is half a win, then points for. */
export const rankKey = (t: Pick<OutlookTeam, "wins" | "ties">) =>
  Number(t.wins) + Number(t.ties) / 2;

export function projectPlayoffs(
  o: Outlook,
  sims = SIMS,
  rand: () => number = mulberry32(0x5eed),
): PlayoffProjection[] | null {
  const teams = o.teams;
  const n = teams.length;
  if (n === 0 || o.matchups.length === 0) return null;

  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const remaining = o.matchups
    .filter((m) => !m.played && m.week <= o.regular_season_weeks)
    .map((m) => [idx.get(m.home_team_id), idx.get(m.away_team_id)] as const)
    .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined);

  /* ------------------------------------------------------------ strength */
  const projected = teams.map((t) => Number(t.proj_ppg)).filter((v) => Number.isFinite(v) && v > 0);
  const posted = teams.flatMap((t) => t.scores.map(Number)).filter((v) => Number.isFinite(v) && v > 0);
  const leagueAvg = projected.length ? mean(projected) : posted.length ? mean(posted) : FALLBACK_PPG;

  const mu = teams.map((t) => {
    const prior = Number(t.proj_ppg) > 0 ? Number(t.proj_ppg) : leagueAvg;
    const g = t.scores.length;
    const avg = g ? mean(t.scores.map(Number)) : prior;
    return (g * avg + PRIOR_GAMES * prior) / (g + PRIOR_GAMES);
  });

  const sd = teams.map((t, i) => {
    const base = SPREAD * mu[i];
    const g = t.scores.length;
    if (g < 2) return Math.max(MIN_SD, base);
    const v = variance(t.scores.map(Number));
    return Math.max(MIN_SD, Math.sqrt((g * v + PRIOR_GAMES * base * base) / (g + PRIOR_GAMES)));
  });

  /* ----------------------------------------------------------- simulate */
  const baseWins = teams.map(rankKey);
  const basePf = teams.map((t) => Number(t.points_for));
  const left = new Array<number>(n).fill(0);
  for (const [h, a] of remaining) { left[h]++; left[a]++; }

  const made = new Array<number>(n).fill(0);
  const byes = new Array<number>(n).fill(0);
  const tops = new Array<number>(n).fill(0);
  const winSum = new Array<number>(n).fill(0);
  const seedSum = new Array<number>(n).fill(0);
  const order = teams.map((_, i) => i);

  for (let s = 0; s < sims; s++) {
    const wins = baseWins.slice();
    const pf = basePf.slice();
    for (const [h, a] of remaining) {
      const hs = normal(mu[h], sd[h], rand);
      const as = normal(mu[a], sd[a], rand);
      pf[h] += hs; pf[a] += as;
      if (hs > as) wins[h] += 1;
      else if (as > hs) wins[a] += 1;
      else { wins[h] += 0.5; wins[a] += 0.5; }
    }
    order.sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]);
    for (let seed = 0; seed < n; seed++) {
      const t = order[seed];
      seedSum[t] += seed + 1;
      winSum[t] += wins[t];
      if (seed < o.playoff_teams) made[t]++;
      if (seed < o.playoff_byes) byes[t]++;
      if (seed === 0) tops[t]++;
    }
  }

  /* ------------------------------------------------- settled, for certain */
  // Another team is a threat if it can still finish with at least this many
  // wins; equal wins go to a points tiebreak we do not try to call.
  const status = teams.map((_, i): PlayoffStatus => {
    const w = baseWins[i];
    let threats = 0, above = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (baseWins[j] + left[j] >= w) threats++;
      if (baseWins[j] > w + left[i]) above++;
    }
    if (above >= o.playoff_teams) return "eliminated";
    if (o.playoff_byes > 0 && threats < o.playoff_byes) return "clinched_bye";
    if (threats < o.playoff_teams) return "clinched";
    return null;
  });

  return teams.map((t, i) => {
    const games = Number(t.wins) + Number(t.losses) + Number(t.ties) + left[i];
    const projWins = winSum[i] / sims;
    return {
      team_id: t.id,
      remaining: left[i],
      proj_wins: projWins,
      proj_losses: Math.max(0, games - projWins),
      playoff_pct: (made[i] / sims) * 100,
      bye_pct: (byes[i] / sims) * 100,
      top_seed_pct: (tops[i] / sims) * 100,
      avg_seed: seedSum[i] / sims,
      status: status[i],
    };
  });
}

/* ------------------------------------------------------------------ maths */

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function variance(xs: number[]) {
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
}

/** Box–Muller. Two uniforms in, one normal out; the second is discarded. */
function normal(mu: number, sd: number, rand: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Small, fast, seedable. Good enough for a season, not for a casino. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
