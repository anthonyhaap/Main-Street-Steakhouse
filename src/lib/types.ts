export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
export type DraftStatus = "setup" | "active" | "paused" | "complete";

export type League = {
  id: string;
  name: string;
  season: number;
  team_count: number;
  commissioner_id: string | null;
  roster_slots: string[];
  scoring_rules: Record<string, number>;
  settings: Record<string, unknown>;
};

export type Team = {
  id: string;
  league_id: string;
  name: string;
  owner_id: string | null;
  owner_email: string | null;
  draft_slot: number | null;
};

export type Draft = {
  id: string;
  league_id: string;
  status: DraftStatus;
  type: string;
  rounds: number;
  pick_seconds: number;
  current_pick: number;
  pick_deadline: string | null;
  remaining_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
};

export type BoardPick = {
  draft_id: string;
  pick_number: number;
  round: number;
  is_autopick: boolean;
  made_at: string;
  team_id: string;
  team_name: string;
  draft_slot: number | null;
  player_id: string;
  player_name: string;
  position: string;
  nfl_team: string | null;
};

export type PoolPlayer = {
  id: string;
  full_name: string;
  position: string;
  nfl_team: string | null;
  status: string | null;
  adp: number | null;
  overall_rank: number | null;
  bye_week: number | null;
  position_rank: number | null;
};

export type Standing = {
  league_id: string;
  team_id: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
};

export type RosterPoint = {
  team_id: string;
  week: number;
  slot: string;
  player_id: string;
  full_name: string;
  position: string;
  nfl_team: string | null;
  league_id: string;
  points: number;
  locked_at: string | null;
  stats_updated_at: string | null;
};

export type Matchup = {
  id: string;
  league_id: string;
  week: number;
  home_team_id: string;
  away_team_id: string;
  home_points: number;
  away_points: number;
};
