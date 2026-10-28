/** Shapes of ff_pickem_week / ff_pickem_weekly_standings / ff_pickem_season_standings. */

export type PickemPick = {
  user_id: string;
  display_name: string;
  selected_team: string | null;
};

export type PickemGame = {
  game_id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  status: string | null;
  status_detail: string | null;
  home_score: number | null;
  away_score: number | null;
  locked: boolean;
  winner: string | null;
  /** Always present, even before the game locks — it's yours to see. */
  my_pick: string | null;
  /** Null until the game kicks off; see ff_pickem_week. */
  picks: PickemPick[] | null;
  /** Null until the game kicks off. Keyed by team abbreviation. */
  distribution: Record<string, number> | null;
};

export type PickemWeek = {
  members: number;
  games: PickemGame[];
};

export type PickemWeeklyStanding = {
  user_id: string;
  display_name: string;
  correct: number;
  incorrect: number;
  remaining: number;
  win_pct: number;
  mine: boolean;
  rank: number;
};

export type PickemSeasonStanding = {
  user_id: string;
  display_name: string;
  correct: number;
  incorrect: number;
  total: number;
  win_pct: number;
  weekly_wins: number;
  mine: boolean;
  rank: number;
};
