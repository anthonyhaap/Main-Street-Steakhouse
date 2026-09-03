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
