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
import type { ActivityItem, Intel, NflGame, RecapExtras, SundayBoard, SundayEvent, SundayHistory, TableRow } from "@/lib/sunday";
import type { ChatItem } from "@/lib/types";

export type GcStage = "pre" | "early" | "late" | "monday" | "final";

export const GC_STAGES: { key: GcStage; label: string; note: string }[] = [
  { key: "pre", label: "Sunday morning", note: "Thursday's game is in the books and nothing else has kicked. The page is a preview: projections, the game of the week, who to watch." },
  { key: "early", label: "One o'clock window", note: "Ten games on. Two of ours are inside the twenty. The game center is live." },
  { key: "late", label: "Late window", note: "The early games are final and the four o'clocks are in the fourth quarter. The hour the page exists for." },
  { key: "monday", label: "Monday night", note: "Every Sunday game is final. Chicago at Minnesota is under way, and a few managers are down to their Monday men." },
  { key: "final", label: "Tuesday", note: "Every game final. The page becomes the day's recap and keeps the board." },
];

const H = 3600_000;

/** The clock at each stage. */
export const GC_NOW: Record<GcStage, number> = {
  pre: Date.parse("2026-11-22T16:30:00Z"),   // Sun 11:30am ET
  early: Date.parse("2026-11-22T19:50:00Z"), // Sun 2:50pm ET
  late: Date.parse("2026-11-22T23:55:00Z"),  // Sun 6:55pm ET
  monday: Date.parse("2026-11-24T02:40:00Z"), // Mon 9:40pm ET
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
  monday: [1, 1, 1, 1, 0.55],
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
  "Rhamondre Stevenson": 2.3,
};

/** Who sat, for the two benches the fixture bothers to fill. */
const BENCH: Record<number, [string, string, string][]> = {
  5: [["Rhamondre Stevenson", "RB", "NE"], ["Khalil Shakir", "WR", "BUF"]],
  0: [["Tyjae Spears", "RB", "TEN"]],
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
    bench: (BENCH[t] ?? []).map(([n, pos, club]) => starter(n, pos, club, null, "BN", stage)),
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

/**
 * The same week from another manager's chair: who is "mine" moves, nothing
 * else does. It is how the preview shows a comfortable win, a blowout loss
 * and a one-point sweat without inventing three more Sundays.
 */
export function gcSeat(b: SundayBoard, teamId: string | null): SundayBoard {
  const mark = (s: ScoreSide) => ({ ...s, mine: s.team_id === teamId });
  return {
    ...b,
    my_team_id: teamId,
    matchups: b.matchups.map((c) => {
      const home = mark(c.home), away = mark(c.away);
      return { ...c, home, away, mine: home.mine || away.mine };
    }),
  };
}

/** A seat for each scenario the brief asks to see, in the late window or on Monday. */
export const GC_SEATS: { team: string | null; label: string }[] = [
  { team: "gt0", label: "Ray" },
  { team: "gt4", label: "Tom (cruising)" },
  { team: "gt5", label: "Nate (getting crushed)" },
  { team: "gt3", label: "Anthony (tight)" },
  { team: "gt8", label: "Lou (just took the lead)" },
  { team: null, label: "No matchup" },
];

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
    events: gcEvents(stage),
    activity: gcActivity(stage),
    intel: gcIntel(),
  };
}

/**
 * What the league knows going into week 12, invented to match the records on
 * the board: the table those records make, a few streaks, the season high,
 * three series with history. Ray is on three straight; Lou has lost four;
 * Tom and Nate are both 5-5; Anthony has beaten Marcus three times running.
 */
const STREAK: Record<string, number> = {
  gt0: 3, gt1: 1, gt2: 2, gt3: -1, gt4: -1, gt5: 1, gt6: -2, gt7: 1, gt8: -4, gt9: 2, gt10: -1, gt11: 1,
};

export function gcIntel(): Intel {
  const rows = TEAMS.map(([, , wins], t) => ({ t, wins, pf: 1000 + wins * 40 + t }));
  rows.sort((a, b) => b.wins - a.wins || b.pf - a.pf);
  const table: TableRow[] = rows.map((r, i) => ({
    team_id: `gt${r.t}`, wins: r.wins, losses: 10 - r.wins, ties: 0, pf: r.pf, rank: i + 1,
    streak: STREAK[`gt${r.t}`] ?? 0,
  }));
  return {
    weights: {
      touchdown: 20, lead_change: 35, within5: 25, within1: 40, fourth_quarter: 15, rivalry: 10, upset: 15,
      league_high: 10, playoff: 15, projected_close: 10, standings: 8, in_action: 2, comeback: 30, season_high: 25,
      big_play_points: 6, scoring_points: 3, close_margin: 5, close_reset: 8, upset_gap: 8, comeback_points: 20,
      monster_points: 30, tightening_from: 15,
    },
    can_tune: true,
    rules: {
      pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6,
      fg_0_39: 3, xp_made: 1, dst_td: 6, dst_int: 2, dst_sack: 1,
    },
    playoff_teams: 6,
    regular_season_weeks: 14,
    table,
    season_high: { points: 152.4, team_id: "gt7", week: 9 },
    h2h: {
      gm1: { meetings: 9, home_wins: 5, away_wins: 4, ties: 0, streak: 1, since: 2019 },
      gm2: { meetings: 6, home_wins: 2, away_wins: 4, ties: 0, streak: -3, since: 2021 },
      gm4: { meetings: 4, home_wins: 1, away_wins: 3, ties: 0, streak: -1, since: 2022 },
    },
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

/* ---------------------------------------------------------------- events -- */

/**
 * The day's Fantasy RedZone, invented to agree with the board above: every
 * score on an impact card is a score the board carries at that stage. Events
 * accumulate — the one o'clock window's are still in the feed at seven, and
 * all of Sunday's are there on Tuesday — which is the point of storing them.
 */
type Ev = Partial<SundayEvent> & Pick<SundayEvent, "type" | "level" | "headline">;

const EARLY: [number, Ev][] = [
  [20, { type: "turnover", level: 2, player_name: "Jalen Hurts", headline: "Jalen Hurts — interception thrown",
    matchup_id: "gm1", team_id: "gt1", opponent_team_id: "gt0", points_added: -2,
    old_score: 42.1, new_score: 40.1, opp_old_score: 21.6, opp_new_score: 21.6, detail: { who: "Dev", opp: "Ray" } }],
  [15, { type: "lead_change", level: 3, headline: "Hank takes the lead over Moe", lead_change: true,
    matchup_id: "gm6", team_id: "gt10", opponent_team_id: "gt11",
    old_score: 21.0, new_score: 27.9, opp_old_score: 23.8, opp_new_score: 23.8, detail: { who: "Hank", opp: "Moe" } }],
  [12, { type: "scoring", level: 1, player_name: "Ja'Marr Chase", headline: "Ja'Marr Chase",
    matchup_id: "gm1", team_id: "gt0", opponent_team_id: "gt1", points_added: 4.1,
    old_score: 21.7, new_score: 25.8, opp_old_score: 52.4, opp_new_score: 52.4, detail: { who: "Ray", opp: "Dev" } }],
  [6, { type: "touchdown", level: 2, player_name: "Josh Allen", headline: "Josh Allen — rushing touchdown",
    reactions: [{ emoji: "🔥", count: 3, mine: false }, { emoji: "😂", count: 1, mine: false }], talk: 1,
    matchup_id: "gm1", team_id: "gt0", opponent_team_id: "gt1", player_id: "gc-Josh Allen", espn_id: "3918298",
    points_added: 8.6, old_score: 25.8, new_score: 34.4, opp_old_score: 52.4, opp_new_score: 52.4,
    detail: { who: "Ray", opp: "Dev" } }],
  [3, { type: "upset_watch", level: 3, headline: "Vic leads Sal", description: "Came in projected 10.6 behind",
    matchup_id: "gm4", team_id: "gt7", opponent_team_id: "gt6", new_score: 51.5, opp_new_score: 50.0,
    detail: { gap: 10.6 } }],
  [1, { type: "red_zone", level: 2, headline: "In the red zone: Jahmyr Gibbs, Amon-Ra St. Brown, Jameson Williams",
    description: "DET ball — 2nd & 6 at GB 14", nfl_game_id: "g-DET-GB", matchup_id: "gm1" , detail: {} }],
];

const LATE: [number, Ev][] = [
  [10, { type: "monster_game", level: 3, player_name: "Jared Goff", headline: "Jared Goff — monster game",
    description: "32.5 points for Marcus", matchup_id: "gm2", team_id: "gt2", opponent_team_id: "gt3", player_id: "gc-Jared Goff",
    new_score: 104.3, opp_new_score: 130.6, detail: { who: "Marcus", opp: "Anthony", points: 32.5 } }],
  [4, { type: "lead_change", level: 3, headline: "Vic takes the lead over Sal", lead_change: true,
    matchup_id: "gm4", team_id: "gt7", opponent_team_id: "gt6",
    old_score: 84.0, new_score: 92.1, opp_old_score: 85.5, opp_new_score: 85.5, detail: { who: "Vic", opp: "Sal" } }],
  [3, { type: "tightening", level: 3, headline: "Marcus cuts Anthony's lead to 3.3", description: "Was down 38.4",
    matchup_id: "gm2", team_id: "gt2", opponent_team_id: "gt3", new_score: 127.3, opp_new_score: 130.6,
    detail: { who: "Marcus", opp: "Anthony", from: 38.4, to: 3.3 } }],
  [4, { type: "lead_change", level: 4, headline: "Lou takes the lead over Gus", lead_change: true,
    reactions: [{ emoji: "😂", count: 4, mine: false }, { emoji: "🔥", count: 3, mine: false }, { emoji: "💀", count: 2, mine: false }], talk: 2,
    description: "Late, with 5 still to play",
    matchup_id: "gm5", team_id: "gt8", opponent_team_id: "gt9",
    old_score: 95.0, new_score: 103.6, opp_old_score: 97.1, opp_new_score: 97.1,
    detail: { who: "Lou", opp: "Gus", late: true } }],
  [3, { type: "touchdown", level: 2, player_name: "Puka Nacua", headline: "Puka Nacua — 40+ yard receiving touchdown",
    matchup_id: "gm2", team_id: "gt2", opponent_team_id: "gt3", player_id: "gc-Puka Nacua", espn_id: "4426515",
    points_added: 9.1, old_score: 118.2, new_score: 127.3, opp_old_score: 130.6, opp_new_score: 130.6,
    detail: { who: "Marcus", opp: "Anthony" } }],
  [2, { type: "close_game", level: 3, headline: "Marcus 127.30 — Anthony 130.60",
    description: "Difference 3.3, 4 still to play", matchup_id: "gm2", detail: { margin: 3.3 } }],
  [1, { type: "red_zone", level: 2, headline: "In the red zone: Patrick Mahomes, Travis Kelce, Rashee Rice, Xavier Worthy",
    description: "KC ball — 3rd & 4 at DEN 9", nfl_game_id: "g-KC-DEN", matchup_id: "gm3", detail: {} }],
];

const MONDAY: [number, Ev][] = [
  [140, { type: "final", level: 1, headline: "Marcus beats Anthony, 139.60–130.60", matchup_id: "gm2", detail: {} }],
  [6, { type: "lead_change", level: 4, headline: "Gus takes the lead over Lou", lead_change: true,
    description: "Late, with 2 still to play", matchup_id: "gm5", team_id: "gt9", opponent_team_id: "gt8",
    old_score: 106.1, new_score: 109.9, opp_old_score: 109.6, opp_new_score: 109.6, detail: { who: "Gus", opp: "Lou", late: true } }],
  [2, { type: "scoring", level: 1, player_name: "Justin Jefferson", headline: "Justin Jefferson",
    matchup_id: "gm1", team_id: "gt0", opponent_team_id: "gt1", points_added: 1.4,
    old_score: 77.0, new_score: 78.4, opp_old_score: 92.2, opp_new_score: 92.2, detail: { who: "Ray", opp: "Dev" } }],
];

const FINAL: [number, Ev][] = [
  [30, { type: "final", level: 1, headline: "Dev beats Ray, 92.20–81.50", matchup_id: "gm1", detail: {} }],
  [29, { type: "final", level: 1, headline: "Marcus beats Anthony, 139.60–130.60", matchup_id: "gm2", detail: {} }],
  [28, { type: "final", level: 1, headline: "Tom beats Nate, 136.20–89.30", matchup_id: "gm3", detail: {} }],
  [27, { type: "final", level: 3, headline: "Vic beats Sal, 105.40–91.00",
    description: "The upset: came in projected 10.6 behind", matchup_id: "gm4", detail: { upset: true } }],
  [26, { type: "final", level: 1, headline: "Gus beats Lou, 120.70–112.80", matchup_id: "gm5", detail: {} }],
  [25, { type: "final", level: 1, headline: "Moe beats Hank, 129.50–118.90", matchup_id: "gm6", detail: {} }],
];

function stamp(list: [number, Ev][], at: number, prefix: string): SundayEvent[] {
  return list.map(([minsAgo, e], i) => ({
    id: `${prefix}-${i}`, priority: e.level * 10, matchup_id: null, team_id: null, opponent_team_id: null,
    player_id: null, player_name: null, espn_id: null, nfl_game_id: null, points_added: null,
    old_score: null, new_score: null, opp_old_score: null, opp_new_score: null, lead_change: false,
    description: null, detail: {},
    ...e,
    created_at: new Date(at - minsAgo * 60_000).toISOString(),
  }) as SundayEvent);
}

export function gcEvents(stage: GcStage): SundayEvent[] {
  const day = [
    ...(stage !== "pre" ? stamp(EARLY, GC_NOW.early, "e") : []),
    ...(stage === "late" || stage === "monday" || stage === "final" ? stamp(LATE, GC_NOW.late, "l") : []),
    ...(stage === "monday" ? stamp(MONDAY, GC_NOW.monday, "m") : []),
    ...(stage === "final" ? stamp(FINAL, GC_NOW.final, "f") : []),
  ];
  return day.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/* -------------------------------------------------------------- activity -- */

/**
 * What the league's people did, invented to sit between the football: a
 * challenge proposed in the morning and accepted at one o'clock, a line about
 * Lou's lead the room piled on, and a challenge settled on Tuesday.
 */
const ACT_EARLY: [number, Omit<ActivityItem, "at">][] = [
  [200, { id: "a-1", kind: "challenge", verb: "proposed", who: "Gus", opp: "Hank", title: "Packers -3.5", stake: "Bragging rights" }],
  [40, { id: "a-2", kind: "challenge", verb: "accepted", who: "Dev", opp: "Ray", title: "Dev outscores Ray", stake: "Steak dinner", matchup_id: "gm1" }],
  [9, { id: "a-3", kind: "chat", verb: "said", who: "Sal", body: "absolute fraud", reactions: 7 }],
];
const ACT_LATE: [number, Omit<ActivityItem, "at">][] = [
  [3, { id: "a-4", kind: "chat", verb: "said", who: "Gus",
    body: "🔥 Lou just took the lead over Gus, 103.6–97.1.\nthere's no way", reactions: 3, sunday_event_id: "l-0" }],
];
const ACT_FINAL: [number, Omit<ActivityItem, "at">][] = [
  [20, { id: "a-5", kind: "challenge", verb: "settled", who: "Dev", opp: "Ray", winner: "Dev", title: "Dev outscores Ray", matchup_id: "gm1" }],
];

function stampAct(list: [number, Omit<ActivityItem, "at">][], at: number): ActivityItem[] {
  return list.map(([minsAgo, a]) => ({ ...a, at: new Date(at - minsAgo * 60_000).toISOString() }));
}

export function gcActivity(stage: GcStage): ActivityItem[] {
  const day = [
    ...(stage !== "pre" ? stampAct(ACT_EARLY, GC_NOW.early) : stampAct(ACT_EARLY.slice(0, 1), GC_NOW.pre + 60 * 60_000)),
    ...(stage === "late" || stage === "monday" || stage === "final" ? stampAct(ACT_LATE, GC_NOW.late) : []),
    ...(stage === "final" ? stampAct(ACT_FINAL, GC_NOW.final) : []),
  ];
  return day.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * What `ff_sunday_recap` would add on Tuesday: how far each side was down on
 * the way (Lou was 24 behind Gus before the lead change), the bets riding on
 * the week, and the line the room loved most.
 */
export function gcRecapExtras(): RecapExtras {
  return {
    week: 12,
    swings: [
      { matchup_id: "gm1", lead_changes: 1, home_worst: 6.2, away_worst: 3.1 },
      { matchup_id: "gm2", lead_changes: 2, home_worst: 4.8, away_worst: 12.6 },
      { matchup_id: "gm3", lead_changes: 0, home_worst: 0, away_worst: 9.4 },
      { matchup_id: "gm4", lead_changes: 1, home_worst: 3.3, away_worst: 7.7 },
      { matchup_id: "gm5", lead_changes: 3, home_worst: 24.1, away_worst: 8.9 },
      { matchup_id: "gm6", lead_changes: 0, home_worst: 15.2, away_worst: 0 },
    ],
    challenges: [
      { id: "ch-1", title: "Dev outscores Ray", stake: "Loser buys the first round", status: "resolved", matchup_id: "gm1", who: "Ray", opp: "Dev", winner: "Dev" },
      { id: "ch-2", title: "Packers -3.5", stake: "Bragging rights", status: "awaiting_result", matchup_id: "gm6", who: "Gus", opp: "Hank", winner: null },
    ],
    best_chat: {
      id: "c-fraud", who: "Sal", body: "absolute fraud", at: new Date(GC_NOW.late - 3 * H).toISOString(),
      reactions: 7, sunday_event_id: null,
    },
  };
}

/** `ff_sunday_history` for the invented league: three seasons of Sundays. */
export function gcSundayHistory(): SundayHistory {
  return {
    moments: [
      { id: "hm-1", season: 2026, week: 12, type: "lead_change", level: 4, headline: "Lou takes the lead over Gus", description: "Late, with 5 still to play", matchup_id: "gm5", reactions: 9, talk: 2, at: new Date(GC_NOW.late - 4 * 60_000).toISOString() },
      { id: "hm-2", season: 2026, week: 7, type: "comeback", level: 4, headline: "Anthony comes back on Marcus", description: "Was down 31.4 and now leads", matchup_id: null, reactions: 6, talk: 4, at: "2026-10-18T22:10:00Z" },
      { id: "hm-3", season: 2025, week: 15, type: "season_high", level: 4, headline: "Vic sets the season high", description: "171.3, past 166.0", matchup_id: null, reactions: 4, talk: 1, at: "2025-12-14T23:40:00Z" },
      { id: "hm-4", season: 2025, week: 3, type: "final", level: 4, headline: "Moe beats Hank, 98.4–97.9", description: "Last place beats first place", matchup_id: null, reactions: 0, talk: 0, at: "2025-09-23T03:30:00Z" },
    ],
    records: {
      comeback: { season: 2026, week: 7, matchup_id: "x", who: "Anthony", opp: "Marcus", down: 31.4 },
      lead_changes: { season: 2025, week: 11, matchup_id: "y", n: 7, home: "Tom", away: "Nate" },
      closest: { season: 2025, week: 3, matchup_id: "z", margin: 0.5, who: "Moe", opp: "Hank" },
      play: { season: 2026, week: 4, id: "p", headline: "Ja'Marr Chase — 3 touchdowns", points: 27.4, who: "Ray" },
    },
    managers: TEAMS.map(([, manager], t) => ({
      team_id: `gt${t}`, who: manager,
      moments: (t * 5) % 4, comebacks: t % 3 === 0 ? 1 : 0, lead_changes: (t * 7) % 9,
      touchdowns: 10 + ((t * 11) % 13), reactions: (t * 13) % 31,
    })),
    weeks: 27,
  };
}
