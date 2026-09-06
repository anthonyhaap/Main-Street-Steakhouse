/**
 * The history wall — the shape of `ff_history(league_id)`, and the words a
 * record earns. Pure, so `/preview/history` can render ten invented seasons
 * through the same code the real wall uses.
 */

export type HistoryManager = {
  manager: string;
  seasons: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  avg: number;
  titles: number;
  finals: number;
  playoff_games: number;
  best_week: { season: number; week: number; points: number } | null;
  title_years: number[];
  current_team: string | null;
  team_id: string | null;
  logo_path: string | null;
};

export type HistorySeason = {
  season: number;
  games: number;
  champion: string | null;
  runner_up: string | null;
  final_score: { w: number; l: number } | null;
  in_progress: boolean;
  best_record: { manager: string; wins: number; losses: number } | null;
};

export type HistoryCell = { manager: string; opponent: string; wins: number; losses: number; ties: number };
export type HistoryStreak = { manager: string; n: number; from: { season: number; week: number }; to: { season: number; week: number } };
export type HistoryBlowout = { season: number; week: number; round: string; winner: string; loser: string; w: number; l: number; margin: number };
export type HistoryHigh = { season: number; week: number; manager: string; points: number; opponent: string };
export type HistoryRivalry = { a: string; b: string; games: number; a_wins: number; b_wins: number; playoff: number; avg_margin: number; score: number };

export type HistoricalStanding = {
  season: number;
  final_rank: number;
  team_name: string | null;
  manager_names: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points_for: number | null;
  points_against: number | null;
  moves: number | null;
};

export type History = {
  league: { id: string; name: string; season: number; est: number };
  games: number;
  seasons: HistorySeason[];
  managers: HistoryManager[];
  grid: HistoryCell[];
  streaks: HistoryStreak[];
  blowouts: HistoryBlowout[];
  highs: HistoryHigh[];
  rivalries: HistoryRivalry[];
  generated_at: string;
};

const WORD = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const times = (n: number) => `${WORD[n] ?? n}-time`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The line under a manager's name. Earned, never flattering: the record
 * decides it, and the record is public.
 */
export function titleOf(m: HistoryManager, all: HistoryManager[]): string {
  const games = m.wins + m.losses + m.ties;
  const pct = games ? m.wins / games : 0;
  const mostWins = all.reduce((a, b) => (b.wins > a.wins ? b : a), all[0]);
  const highestAvg = all.reduce((a, b) => (b.avg > a.avg ? b : a), all[0]);
  const lowestPct = all.reduce((a, b) => {
    const ga = a.wins + a.losses + a.ties, gb = b.wins + b.losses + b.ties;
    return (gb ? b.wins / gb : 1) < (ga ? a.wins / ga : 1) ? b : a;
  }, all[0]);

  if (m.titles >= 3) return `${cap(times(m.titles))} champion. The house that ${m.manager.split(" ")[0]} built.`;
  if (m.titles === 2) return `Two-time champion${m.finals > 2 ? `, ${m.finals} finals` : ""}.`;
  if (m.titles === 1) {
    const yr = m.title_years[0];
    return m.finals > 1 ? `Champion, ${yr}. ${cap(times(m.finals))} finalist.` : `Champion, ${yr}.`;
  }
  if (m.finals >= 2) return `${cap(times(m.finals))} finalist. Never won.`;
  if (m.finals === 1) return "Made one final. Lost it.";
  if (all.length > 1 && m === mostWins && m.wins > 0) return "Most wins in league history. No ring.";
  if (all.length > 1 && m === highestAvg && m.avg > 0) return "Scores more than anyone. Wins less than you'd think.";
  if (m.seasons >= 2 && m.playoff_games === 0) return "Has never seen a playoff game.";
  if (all.length > 1 && m === lowestPct && games >= 10) return "The league's favourite opponent.";
  if (m.seasons >= 4 && pct >= 0.55) return "Always there in December. Never in January.";
  if (m.seasons <= 1) return "Still writing the first chapter.";
  return `${m.seasons} seasons at the table.`;
}

/** A pair's all-time line, from the grid. */
export function cellOf(grid: HistoryCell[], a: string, b: string): HistoryCell | null {
  return grid.find((c) => c.manager === a && c.opponent === b) ?? null;
}

/* ------------------------------------------------------------- rivalry -- */

/**
 * `ff_rivalry(league, a, b)` — one pairing, told properly. Every points figure
 * is from A's side whichever way round the game was actually played, so
 * nothing here has to work out which column somebody was in.
 */
export type RivalryCard = {
  a: string;
  b: string;
  games: number;
  a_wins: number;
  b_wins: number;
  ties: number;
  playoff_games: number;
  first_season: number | null;
  streak_holder: string | null;
  streak: number;
  last: {
    season: number; week: number; round: string;
    a_points: number; b_points: number; winner: string | null;
  } | null;
  biggest: {
    season: number; week: number; winner: string;
    margin: number; a_points: number; b_points: number;
  } | null;
};

/** `ff_rivalries_for_week` — a whole board's worth, keyed by matchup id. */
export type WeekRivalries = Record<string, RivalryCard | null>;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The headline. This is the sentence the feature exists for — the one that
 * makes somebody say "wait, I'm 2-11 against Mike?" — so it leads with the
 * record and never with a pleasantry.
 *
 * `me` is the manager reading it, when he is one of the two. Being told "you
 * have lost six straight to him" lands; being told "Mike leads Dave 9-2" about
 * your own game reads like somebody else's fixture.
 */
export function rivalryLine(r: RivalryCard, me?: string | null): string {
  if (r.games === 0) return "They have never played.";

  const mine = me === r.a ? "a" : me === r.b ? "b" : null;
  const [myWins, theirWins] = mine === "b" ? [r.b_wins, r.a_wins] : [r.a_wins, r.b_wins];
  const them = first(mine === "b" ? r.a : r.b);
  const tied = r.a_wins === r.b_wins;

  const record = mine
    ? tied
      ? `All square with ${them}, ${myWins}-${theirWins}${r.ties ? `-${r.ties}` : ""}.`
      : myWins > theirWins
        ? `You lead ${them} ${myWins}-${theirWins}${r.ties ? `-${r.ties}` : ""}.`
        : `You are ${myWins}-${theirWins}${r.ties ? `-${r.ties}` : ""} against ${them}.`
    : tied
      ? `${first(r.a)} and ${first(r.b)} are level at ${r.a_wins}-${r.b_wins}${r.ties ? `-${r.ties}` : ""}.`
      : r.a_wins > r.b_wins
        ? `${first(r.a)} leads ${first(r.b)} ${r.a_wins}-${r.b_wins}${r.ties ? `-${r.ties}` : ""}.`
        : `${first(r.b)} leads ${first(r.a)} ${r.b_wins}-${r.a_wins}${r.ties ? `-${r.ties}` : ""}.`;

  // A run is the part that stings, so it gets its own clause rather than being
  // left for the reader to infer from a won-lost record.
  if (r.streak >= 2 && r.streak_holder) {
    const held = mine
      ? r.streak_holder === (mine === "a" ? r.a : r.b)
        ? `You have won the last ${r.streak}.`
        : `He has won the last ${r.streak}.`
      : `${first(r.streak_holder)} has won the last ${r.streak}.`;
    return `${record} ${held}`;
  }
  return record;
}

/** How a single meeting reads in a list: "2024 · Week 11 · Bo by 80". */
export function meetingLine(m: NonNullable<RivalryCard["last"]>): string {
  const margin = Math.abs(Number(m.a_points) - Number(m.b_points));
  const score = `${fmtPts(m.a_points)}-${fmtPts(m.b_points)}`;
  if (!m.winner) return `Tied ${score}`;
  return `${first(m.winner)} by ${fmtPts(margin)}, ${score}`;
}

const fmtPts = (n: number) => {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/** "Week 11" for a regular game, the round's own name for a playoff one. */
export function roundLabel(round: string, week: number): string {
  if (!round || round === "regular") return `Week ${week}`;
  if (round === "final") return "The final";
  return round.charAt(0).toUpperCase() + round.slice(1);
}

/* ------------------------------------------------------------- heat map -- */

const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const LOSE = hex("#b3341f");
const EVEN = hex("#c9bda6");
const WIN = hex("#16794c");

/** Colour of a head-to-head cell: wine when he owns you, green when you own him. */
export function heat(wins: number, losses: number): string {
  const n = wins + losses;
  if (n === 0) return "transparent";
  const p = wins / n;
  const [from, to, t] = p < 0.5 ? [LOSE, EVEN, p / 0.5] : [EVEN, WIN, (p - 0.5) / 0.5];
  // Few games: pull toward even, so a 1–0 is not painted like a 9–0.
  const conf = Math.min(1, n / 6);
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  const rgb = mix.map((c, i) => Math.round(EVEN[i] + (c - EVEN[i]) * conf));
  return `rgb(${rgb.join(",")})`;
}
