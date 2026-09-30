/**
 * A Sunday for the game center, invented.
 *
 * `/preview/matchups` runs on three tables and a slate of opponents that are
 * all the Jets, which is plenty for one card and not enough for a broadcast:
 * the game center shows all six tables at once and the whole NFL slate beside
 * them, and the two have to agree — a player's club has to be in a game on the
 * slate, and the game has to be in the state his row says it is.
 *
 * So this is one coherent week. Sixteen real fixtures across Thursday, the
 * one o'clock window, the four o'clock window, Sunday night and Monday; twelve
 * lineups of real players with each club in exactly one game; and four clocks
 * that run it forward. Scores, projections, possession and every manager are
 * invented. The managers are not real people.
 *
 * Only type imports, so the arithmetic can be run and inspected outside the
 * app.
 */

import type { ScoreCard, ScoreSide, ScoreStarter, Talk } from "@/lib/scoreboard";
import type { NflGame, SundayBoard } from "@/lib/sunday";
import type { ChatItem } from "@/lib/types";

export type GcStage = "pre" | "early" | "late" | "final";

export const GC_STAGES: { key: GcStage; label: string; note: string }[] = [
  { key: "pre", label: "Sunday morning", note: "Thursday's game is in the books and nothing else has kicked. The page is a preview: projections, the game of the week, who to watch." },
  { key: "early", label: "One o'clock window", note: "Ten games on. Two of ours are inside the twenty. The game center is live." },
  { key: "late", label: "Late window", note: "The early games are final and the four o'clocks are in the fourth quarter. The hour the page exists for." },
  { key: "final", label: "Tuesday", note: "Every game final. The page becomes the day's recap and keeps the board." },
];

const H = 3600_000;

/** The clock at each stage. */
export const GC_NOW: Record<GcStage, number> = {
  pre: Date.parse("2026-11-22T16:30:00Z"),   // Sun 11:30am ET
  early: Date.parse("2026-11-22T19:50:00Z"), // Sun 2:50pm ET
  late: Date.parse("2026-11-22T23:55:00Z"),  // Sun 6:55pm ET
  final: Date.parse("2026-11-25T02:00:00Z"), // Mon night, after the late game
};

/** Kickoff for each window: Thursday, 1pm, 4:25, Sunday night, Monday. */
const KICK = [
  "2026-11-20T01:15:00Z", "2026-11-22T18:00:00Z", "2026-11-22T21:25:00Z",
  "2026-11-23T01:20:00Z", "2026-11-24T01:15:00Z",
];

/** away, home, window. Thirty-two clubs, each once. */
const SLATE: [string, string, number][] = [
  ["NYJ", "NE", 0],
  ["BUF", "MIA", 1], ["DAL", "PHI", 1], ["DET", "GB", 1], ["CIN", "PIT", 1], ["IND", "HOU", 1],
  ["TEN", "JAX", 1], ["WAS", "NYG", 1], ["CAR", "ATL", 1], ["CLE", "BAL", 1], ["NO", "TB", 1],
  ["KC", "DEN", 2], ["SF", "SEA", 2], ["LAR", "ARI", 2],
  ["LV", "LAC", 3],
  ["CHI", "MIN", 4],
];

/** How far through its game each window is at each stage: 0 not kicked, 1 final. */
const PROGRESS: Record<GcStage, number[]> = {
  pre: [1, 0, 0, 0, 0],
  early: [1, 0.66, 0, 0, 0],
  late: [1, 1, 0.9, 0, 0],
  final: [1, 1, 1, 1, 1],
};

/** Which games have the ball in the red zone, per stage: club with the ball, down and distance. */
const DRIVES: Partial<Record<GcStage, Record<string, [string, string | null]>>> = {
  early: {
    "BUF@MIA": ["BUF", "1st & Goal at MIA 8"],
    "DET@GB": ["DET", "2nd & 6 at GB 14"],
    "DAL@PHI": ["PHI", null],
    "CIN@PIT": ["CIN", null],
  },
  late: {
    "KC@DEN": ["KC", "3rd & 4 at DEN 9"],
    "SF@SEA": ["SEA", null],
    "LAR@ARI": ["ARI", null],
  },
};

/** name, club, ESPN id where the house fixture already vouches for it. */
type P = [string, string, string | null];
const QB: P[] = [
  ["Josh Allen", "BUF", "3918298"], ["Jalen Hurts", "PHI", null], ["Jared Goff", "DET", null],
  ["Joe Burrow", "CIN", null], ["Lamar Jackson", "BAL", null], ["Patrick Mahomes", "KC", "3139477"],
  ["Brock Purdy", "SF", null], ["Jayden Daniels", "WAS", null], ["Baker Mayfield", "TB", null],
  ["Kyler Murray", "ARI", null], ["Justin Herbert", "LAC", null], ["J.J. McCarthy", "MIN", null],
];
const RB: P[] = [
  ["Saquon Barkley", "PHI", null], ["Jahmyr Gibbs", "DET", "4429795"], ["Bijan Robinson", "ATL", "4430807"],
  ["Derrick Henry", "BAL", null], ["Christian McCaffrey", "SF", "3117251"], ["Jonathan Taylor", "IND", "4242335"],
  ["De'Von Achane", "MIA", "4429160"], ["James Cook", "BUF", null], ["Josh Jacobs", "GB", null],
  ["Kyren Williams", "LAR", null], ["Chase Brown", "CIN", null], ["Bucky Irving", "TB", null],
  ["Breece Hall", "NYJ", null], ["Chuba Hubbard", "CAR", null], ["Jaylen Warren", "PIT", null],
  ["Kenneth Walker III", "SEA", null], ["Alvin Kamara", "NO", null], ["Joe Mixon", "HOU", null],
  ["David Montgomery", "DET", null], ["Tony Pollard", "TEN", null], ["Ashton Jeanty", "LV", null],
  ["Omarion Hampton", "LAC", null], ["D'Andre Swift", "CHI", null], ["Aaron Jones", "MIN", null],
];
const WR: P[] = [
  ["Ja'Marr Chase", "CIN", "4362628"], ["Justin Jefferson", "MIN", null], ["CeeDee Lamb", "DAL", null],
  ["Amon-Ra St. Brown", "DET", "4374302"], ["Puka Nacua", "LAR", "4426515"], ["Malik Nabers", "NYG", null],
  ["Nico Collins", "HOU", null], ["A.J. Brown", "PHI", null], ["Drake London", "ATL", "4426502"],
  ["Brian Thomas Jr.", "JAX", null], ["Jaxon Smith-Njigba", "SEA", "4430878"], ["Garrett Wilson", "NYJ", null],
  ["Tee Higgins", "CIN", null], ["Mike Evans", "TB", null], ["Ladd McConkey", "LAC", null],
  ["Terry McLaurin", "WAS", null], ["Davante Adams", "LAR", null], ["DK Metcalf", "PIT", null],
  ["Tyreek Hill", "MIA", null], ["Jaylen Waddle", "MIA", null], ["Zay Flowers", "BAL", null],
  ["DJ Moore", "CHI", null], ["Courtland Sutton", "DEN", null], ["Xavier Worthy", "KC", null],
];
const TE: P[] = [
  ["Trey McBride", "ARI", "4361307"], ["Brock Bowers", "LV", null], ["George Kittle", "SF", null],
  ["Sam LaPorta", "DET", null], ["Travis Kelce", "KC", null], ["Mark Andrews", "BAL", null],
  ["T.J. Hockenson", "MIN", null], ["Tucker Kraft", "GB", "4572680"], ["Dalton Kincaid", "BUF", null],
  ["Jake Ferguson", "DAL", null], ["David Njoku", "CLE", null], ["Evan Engram", "DEN", null],
];
const FLEX: [string, string, string, string | null][] = [
  ["Rashee Rice", "WR", "KC", null], ["Jameson Williams", "WR", "DET", null], ["George Pickens", "WR", "DAL", null],
  ["DeVonta Smith", "WR", "PHI", null], ["Travis Etienne Jr.", "RB", "JAX", null], ["Tetairoa McMillan", "WR", "CAR", null],
  ["Chris Olave", "WR", "NO", null], ["Jerry Jeudy", "WR", "CLE", null], ["Jordan Addison", "WR", "MIN", null],
  ["Rome Odunze", "WR", "CHI", null], ["Quinshon Judkins", "RB", "CLE", null], ["TreVeyon Henderson", "RB", "NE", null],
];
const K: P[] = [
  ["Brandon Aubrey", "DAL", "4249087"], ["Chris Boswell", "PIT", "16339"], ["Cameron Dicker", "LAC", null],
  ["Jake Bates", "DET", null], ["Harrison Butker", "KC", null], ["Ka'imi Fairbairn", "HOU", null],
  ["Tyler Bass", "BUF", null], ["Wil Lutz", "DEN", null], ["Jason Myers", "SEA", null],
  ["Evan McPherson", "CIN", null], ["Jake Elliott", "PHI", null], ["Chase McLaughlin", "TB", null],
];
const DST: [string, string][] = [
  ["Houston Texans", "HOU"], ["Denver Broncos", "DEN"], ["Pittsburgh Steelers", "PIT"],
  ["Baltimore Ravens", "BAL"], ["Philadelphia Eagles", "PHI"], ["Minnesota Vikings", "MIN"],
  ["Kansas City Chiefs", "KC"], ["Buffalo Bills", "BUF"], ["Detroit Lions", "DET"],
  ["Seattle Seahawks", "SEA"], ["Los Angeles Chargers", "LAC"], ["Green Bay Packers", "GB"],
];

/** Twelve tables, in the order ff_scoreboard pairs them: 0 v 1, 2 v 3, … */
const TEAMS: [string, string, number][] = [
  ["The Porterhouse", "Ray", 6], ["Dry Aged Dynasty", "Dev", 7],
  ["Prime Cut", "Marcus", 9], ["Gridiron Butchers", "Anthony", 4],
  ["Bone-In Bandits", "Tom", 5], ["Wagyu Warriors", "Nate", 5],
  ["Medium Rare", "Sal", 3], ["The Tomahawks", "Vic", 8],
  ["Filet Mignonsters", "Lou", 2], ["Surf & Turf", "Gus", 6],
  ["Chop House", "Hank", 7], ["Strip Steak Club", "Moe", 4],
];
export const GC_MY_TEAM = "gt0";

/** Deterministic 0..1 from a string, so the fixture never flickers. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * A few afternoons written on purpose rather than drawn: Nacua's big day is
 * what puts Marcus within a score of Anthony in the late window, which is the
 * close game the page has to lift above the rest.
 */
const SWING: Record<string, number> = {
  "Puka Nacua": 1.55,
};

const RANGE: Record<string, [number, number]> = {
  QB: [16, 24], RB: [9, 17], WR: [9, 17], TE: [6, 12], K: [7, 9.5], DST: [5, 9],
};

const gameOf = (club: string) => {
  const i = SLATE.findIndex(([a, h]) => a === club || h === club);
  return { i, g: SLATE[i] };
};

/** ESPN's clock text for a fraction of a game: "10:12 - 3rd". */
function clockText(progress: number, seed: number): string {
  const q = Math.min(4, Math.max(1, Math.ceil(progress * 4)));
  const within = progress * 4 - (q - 1);
  const secs = Math.max(12, Math.round((1 - within) * 900 + seed * 60) % 900);
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss} - ${["1st", "2nd", "3rd", "4th"][q - 1]}`;
}

function gameProgress(stage: GcStage, i: number): number {
  const window = SLATE[i][2];
  const base = PROGRESS[stage][window];
  if (base === 0 || base === 1) return base;
  // Games in the same window drift apart a little, the way they do.
  return Math.min(0.97, base + ((i * 7) % 5) * 0.035 - 0.05);
}

function starter(
  name: string, position: string, club: string, espn: string | null, slot: string, stage: GcStage,
): ScoreStarter {
  const { i } = gameOf(club);
  const [away, home, window] = SLATE[i];
  const progress = gameProgress(stage, i);
  const status = progress === 0 ? "pre" : progress === 1 ? "post" : "in";
  const [lo, hi] = RANGE[position] ?? [8, 14];
  const proj = Math.round((lo + (hi - lo) * hash(name)) * 10) / 10;
  const swing = SWING[name] ?? 0.35 + hash(`${name}:day`) * 1.35;
  const points = status === "pre" ? 0 : Math.round(proj * swing * progress * 10) / 10;
  const n = (x: number) => Math.round(x);
  const stats: Record<string, number> | null = status === "pre" || points <= 0 ? null
    : position === "QB" ? { pass_att: n(14 + points), pass_cmp: n(9 + points * 0.7), pass_yd: n(points * 12), pass_td: points > 16 ? 2 : points > 8 ? 1 : 0, rush_att: 3, rush_yd: n(points * 0.8) }
    : position === "RB" ? { rush_att: n(5 + points * 0.8), rush_yd: n(points * 5.5), rush_td: points > 14 ? 1 : 0, rec: n(points * 0.2), rec_yd: n(points * 1.1) }
    : position === "WR" || position === "TE" ? { rec: n(2 + points * 0.3), rec_tgt: n(4 + points * 0.4), rec_yd: n(points * 7), rec_td: points > 14 ? 1 : 0 }
    : position === "K" ? { fgm: n(points / 3.6), fgmiss: 0, xpm: n(points % 3), xpmiss: 0 }
    : { sack: n(points * 0.4), int: points > 8 ? 1 : 0, pts_allow: Math.max(0, n(27 - points * 1.5)) };
  return {
    player_id: `gc-${name}`, full_name: name, position, nfl_team: club, slot, espn_id: espn,
    points, projection: proj, stats,
    kickoff_at: KICK[window],
    game_status: status,
    game_detail: status === "in" ? clockText(progress, hash(away)) : status === "post" ? "Final" : null,
    opponent: club === home ? away : home, at_home: club === home, severity: null,
    on_bye: false, final: status === "post",
  };
}

function side(t: number, stage: GcStage): ScoreSide {
  const [name, manager, wins] = TEAMS[t];
  const [fx, fxPos, fxClub, fxEspn] = FLEX[t];
  const starters: ScoreStarter[] = [
    starter(QB[t][0], "QB", QB[t][1], QB[t][2], "QB", stage),
    starter(RB[2 * t][0], "RB", RB[2 * t][1], RB[2 * t][2], "RB", stage),
    starter(RB[2 * t + 1][0], "RB", RB[2 * t + 1][1], RB[2 * t + 1][2], "RB", stage),
    starter(WR[2 * t][0], "WR", WR[2 * t][1], WR[2 * t][2], "WR", stage),
    starter(WR[2 * t + 1][0], "WR", WR[2 * t + 1][1], WR[2 * t + 1][2], "WR", stage),
    starter(TE[t][0], "TE", TE[t][1], TE[t][2], "TE", stage),
    starter(fx, fxPos, fxClub, fxEspn, "FLEX", stage),
    starter(K[t][0], "K", K[t][1], K[t][2], "K", stage),
    starter(DST[t][0], "DST", DST[t][1], null, "DST", stage),
  ];
  const sum = (f: (p: ScoreStarter) => number) => Math.round(starters.reduce((s, p) => s + f(p), 0) * 100) / 100;
  const best = [...starters].sort((a, b) => b.points - a.points)[0];
  return {
    team_id: `gt${t}`, name, manager_name: manager, logo_path: null,
    wins, losses: 10 - wins, ties: 0,
    points: sum((p) => p.points),
    proj: sum((p) => Number(p.projection ?? 0)),
    proj_left: sum((p) => (p.game_status === "pre" ? Number(p.projection ?? 0) : 0)),
    yet_to_play: starters.filter((p) => !p.final).length,
    in_action: starters.filter((p) => p.game_status === "in").length,
    empty_slots: 0,
    top: best ? { full_name: best.full_name, position: best.position, nfl_team: best.nfl_team, points: best.points, game_status: best.game_status } : null,
    starters,
    bench: [],
    mine: `gt${t}` === GC_MY_TEAM,
  };
}

function nflGames(stage: GcStage): NflGame[] {
  const drives = DRIVES[stage] ?? {};
  return SLATE.map(([away, home, window], i) => {
    const progress = gameProgress(stage, i);
    const status = progress === 0 ? "pre" : progress === 1 ? "post" : "in";
    const finalAway = 10 + Math.round(hash(`${away}:pts`) * 24);
    const finalHome = 10 + Math.round(hash(`${home}:pts`) * 24);
    const drive = drives[`${away}@${home}`];
    return {
      id: `g-${away}-${home}`,
      away, home,
      away_score: status === "pre" ? null : Math.round(finalAway * progress),
      home_score: status === "pre" ? null : Math.round(finalHome * progress),
      kickoff_at: KICK[window],
      status,
      detail: status === "in" ? clockText(progress, hash(away)) : status === "post" ? "Final" : null,
      home_spread: Math.round((hash(`${home}:line`) * 14 - 7) * 2) / 2,
      possession: status === "in" ? (drive?.[0] ?? (i % 2 ? home : away)) : null,
      red_zone: status === "in" && !!drive?.[1],
      down_distance: status === "in" ? (drive?.[1] ?? null) : null,
      updated_at: new Date(GC_NOW[stage] - 60_000).toISOString(),
    };
  });
}

const QUIET: Talk = { count: 0, last: null };

export function gcBoard(stage: GcStage): SundayBoard {
  const now = GC_NOW[stage];
  const nfl = nflGames(stage);
  const cards: ScoreCard[] = [];
  for (let t = 0; t < TEAMS.length; t += 2) {
    const home = side(t, stage), away = side(t + 1, stage);
    cards.push({ id: `gm${t / 2 + 1}`, week: 12, mine: home.mine || away.mine, talk: QUIET, home, away });
  }
  const done = nfl.filter((g) => g.status === "post").length;
  const on = nfl.filter((g) => g.status === "in").length;
  const next = nfl.filter((g) => g.kickoff_at && Date.parse(g.kickoff_at) > now)
    .map((g) => g.kickoff_at!).sort()[0] ?? null;
  return {
    league: {
      id: "11111111-1111-1111-1111-111111111111", name: "Main Street Steakhouse", season: 2026,
      team_count: 12, regular_season_weeks: 14,
      roster_slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BN", "BN", "BN"],
    },
    week: 12,
    my_team_id: GC_MY_TEAM,
    games: {
      week: 12, first_kick: KICK[0], last_kick: KICK[4], total: nfl.length,
      final: done, in_progress: on, next_kickoff: next,
    },
    matchups: cards,
    stats_updated_at: new Date(now - 70_000).toISOString(),
    projections_updated_at: new Date(now - 4 * H).toISOString(),
    now: new Date(now).toISOString(),
    generated_at: new Date(now).toISOString(),
    nfl,
  };
}

/** The room, invented: a few lines and one reaction, for the chat panel. */
export function gcChat(stage: GcStage): ChatItem[] {
  const now = GC_NOW[stage];
  const lines: [string, string, number, boolean][] = [
    ["Dev", "Ray starting a kicker in a dome game is a cry for help.", 95, false],
    ["Ray", "Aubrey from 58 says hi.", 80, true],
    ["Marcus", "Nine and one. Somebody take the belt off me.", 44, false],
    ["Sal", "absolute fraud", 12, false],
    ["Vic", "Sal is 3-7 and talking. Incredible.", 4, false],
  ];
  return lines.map(([author, body, minsAgo, mine], i) => ({
    id: `gc-msg-${i}`, at: new Date(now - minsAgo * 60_000).toISOString(),
    source: "message" as const, kind: "manager", body, detail: null,
    author, author_team_id: null, mine, source_type: null, source_id: null,
    reactions: i === 3 ? [{ emoji: "😂", count: 7, mine: false }] : [],
    poll: null, matchup: null, parent: null, mentions: [],
  })) as ChatItem[];
}
