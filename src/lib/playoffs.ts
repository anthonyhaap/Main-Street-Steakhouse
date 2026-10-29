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

/**
 * Whether the simulation has anything to say.
 *
 * Run it on twelve 0–0 teams with no rosters and it does exactly what it is
 * asked: draws every team from the same distribution and reports that they all
 * have about a coin flip's chance, with a projected 7–7 apiece. Every number is
 * correct and the screen is a lie — it looks like analysis of a league that has
 * not happened yet.
 *
 * So the odds are withheld until something can tell the teams apart: a result,
 * or at least a drafted roster to project from. This is the one case; a league
 * that has drafted but not kicked off still gets odds, with the board saying
 * they lean entirely on projected lineups.
 */
export function oddsCanSeparate(o: Outlook): boolean {
  if (o.matchups.some((m) => m.played)) return true;
  const strengths = o.teams
    .map((t) => Number(t.proj_ppg))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (strengths.length < o.teams.length) return false;
  // Rosters exist but every one prices the same — nothing to separate them.
  return Math.max(...strengths) - Math.min(...strengths) >= 1;
}

export function projectPlayoffs(
  o: Outlook,
  sims = SIMS,
  rand: () => number = mulberry32(0x5eed),
): PlayoffProjection[] | null {
  return simulate(o, sims, rand)?.projections ?? null;
}

/* ------------------------------------------------------------- the race */

/**
 * One game this week, and what its result does to everybody's odds.
 *
 * `ifHome` and `ifAway` are each team's playoff chance in the simulated
 * seasons where that side won this game, in the outlook's team order — so a
 * manager can read his own stake in a game he is not playing in.
 */
export type GameStakes = {
  matchup_id: string;
  home_team_id: string;
  away_team_id: string;
  ifHome: number[];
  ifAway: number[];
  /** How far the two teams' own odds swing on it, added together. */
  leverage: number;
};

/** A team's chances by how many of its remaining games it wins. */
export type WinsPath = { more: number; pct: number; share: number };

export type PlayoffRace = {
  projections: PlayoffProjection[];
  /** The week being looked at: the first with a game still to play. */
  week: number | null;
  /** This week's games, the biggest swing first. */
  games: GameStakes[];
  /** Team id → its chances by extra wins, 0 to all of them. */
  paths: Map<string, WinsPath[]>;
  teamIndex: Map<string, number>;
};

/**
 * The playoff picture as a race rather than a table: the same simulation as
 * `projectPlayoffs` — same seed, same draws, so the odds agree to the decimal
 * with the column beside them — with two things kept that the table throws
 * away. For every game this week, which side won in each simulated season;
 * and for every team, how many more games it won. Conditioning on those turns
 * "you are at 48%" into "win and you are at 64%, lose and you are at 31%",
 * and "how many more do I need".
 */
export function playoffRace(
  o: Outlook,
  sims = SIMS,
  rand: () => number = mulberry32(0x5eed),
): PlayoffRace | null {
  return simulate(o, sims, rand);
}

export type MyStakes = {
  now: number;
  /** Null when this team has no game in the race's week. */
  ifWin: number | null;
  ifLose: number | null;
  /** Other games this week, the side to root for, and what it is worth. */
  rootFor: { matchup_id: string; team_id: string; against_id: string; gain: number }[];
  paths: WinsPath[];
};

/** One team's stake in this week: its own game, and the others worth watching. */
export function stakesFor(race: PlayoffRace, teamId: string, limit = 2, minGain = 1.5): MyStakes | null {
  const i = race.teamIndex.get(teamId);
  const p = race.projections.find((x) => x.team_id === teamId);
  if (i === undefined || !p) return null;
  const own = race.games.find((g) => g.home_team_id === teamId || g.away_team_id === teamId);
  const home = own?.home_team_id === teamId;
  const rootFor = race.games
    .filter((g) => g !== own)
    .map((g) => {
      const d = g.ifHome[i] - g.ifAway[i];
      return d >= 0
        ? { matchup_id: g.matchup_id, team_id: g.home_team_id, against_id: g.away_team_id, gain: d }
        : { matchup_id: g.matchup_id, team_id: g.away_team_id, against_id: g.home_team_id, gain: -d };
    })
    .filter((r) => r.gain >= minGain)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit);
  return {
    now: p.playoff_pct,
    ifWin: own ? (home ? own.ifHome[i] : own.ifAway[i]) : null,
    ifLose: own ? (home ? own.ifAway[i] : own.ifHome[i]) : null,
    rootFor,
    paths: race.paths.get(teamId) ?? [],
  };
}

/**
 * The fewest extra wins that get this team in at least `pct` of the time,
 * among the counts the simulation actually reached. Null when none does —
 * winning out is not enough on its own.
 */
export function winsNeeded(paths: WinsPath[], pct = 90): WinsPath | null {
  return paths.find((w) => w.share > 0 && w.pct >= pct) ?? null;
}

/* ------------------------------------------------------- the simulation */

function simulate(o: Outlook, sims: number, rand: () => number): PlayoffRace | null {
  const teams = o.teams;
  const n = teams.length;
  if (n === 0 || o.matchups.length === 0) return null;

  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const open = o.matchups
    .filter((m) => !m.played && m.week <= o.regular_season_weeks)
    .map((m) => ({ m, h: idx.get(m.home_team_id), a: idx.get(m.away_team_id) }))
    .filter((x): x is { m: typeof x.m; h: number; a: number } => x.h !== undefined && x.a !== undefined);
  const remaining = open.map((x) => [x.h, x.a] as const);
  const focusWeek = open.length ? Math.min(...open.map((x) => x.m.week)) : null;
  // Positions in `remaining` of this week's games.
  const focus = open.flatMap((x, k) => (x.m.week === focusWeek ? [k] : []));

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

  // This week's games: seasons each side won, and who got in in those.
  const fWon = focus.map(() => [0, 0]);
  const fMade = focus.map(() => [new Array<number>(n).fill(0), new Array<number>(n).fill(0)]);
  // Per team, by extra wins: seasons, and seasons that ended in the playoffs.
  const pathAll = left.map((l) => new Array<number>(l + 1).fill(0));
  const pathMade = left.map((l) => new Array<number>(l + 1).fill(0));
  const winner = new Array<number>(remaining.length).fill(-1);
  const inThisSim = new Array<boolean>(n).fill(false);

  for (let s = 0; s < sims; s++) {
    const wins = baseWins.slice();
    const pf = basePf.slice();
    for (let k = 0; k < remaining.length; k++) {
      const [h, a] = remaining[k];
      const hs = normal(mu[h], sd[h], rand);
      const as = normal(mu[a], sd[a], rand);
      pf[h] += hs; pf[a] += as;
      if (hs > as) { wins[h] += 1; winner[k] = 0; }
      else if (as > hs) { wins[a] += 1; winner[k] = 1; }
      else { wins[h] += 0.5; wins[a] += 0.5; winner[k] = -1; }
    }
    order.sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]);
    for (let seed = 0; seed < n; seed++) {
      const t = order[seed];
      seedSum[t] += seed + 1;
      winSum[t] += wins[t];
      inThisSim[t] = seed < o.playoff_teams;
      if (seed < o.playoff_teams) made[t]++;
      if (seed < o.playoff_byes) byes[t]++;
      if (seed === 0) tops[t]++;
    }
    for (let f = 0; f < focus.length; f++) {
      const side = winner[focus[f]];
      if (side < 0) continue;
      fWon[f][side]++;
      const row = fMade[f][side];
      for (let t = 0; t < n; t++) if (inThisSim[t]) row[t]++;
    }
    for (let t = 0; t < n; t++) {
      // Whole wins only: a tie is half of one and rare enough to round down.
      const more = Math.min(left[t], Math.max(0, Math.floor(wins[t] - baseWins[t])));
      pathAll[t][more]++;
      if (inThisSim[t]) pathMade[t][more]++;
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

  const projections = teams.map((t, i): PlayoffProjection => {
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

  const pctOf = (hits: number[], of: number) => hits.map((c) => (of ? (c / of) * 100 : 0));
  const games = focus.map((k, f): GameStakes => {
    const { m, h, a } = open[k];
    const ifHome = pctOf(fMade[f][0], fWon[f][0]);
    const ifAway = pctOf(fMade[f][1], fWon[f][1]);
    return {
      matchup_id: m.id, home_team_id: m.home_team_id, away_team_id: m.away_team_id,
      ifHome, ifAway,
      leverage: Math.abs(ifHome[h] - ifAway[h]) + Math.abs(ifHome[a] - ifAway[a]),
    };
  }).sort((x, y) => y.leverage - x.leverage);

  const paths = new Map(teams.map((t, i) => [t.id, pathAll[i].map((c, more): WinsPath => ({
    more, share: (c / sims) * 100, pct: c ? (pathMade[i][more] / c) * 100 : 0,
  }))]));

  return { projections, week: focusWeek, games, paths, teamIndex: idx };
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
