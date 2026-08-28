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

export type LeagueMessage = {
  id: string;
  league_id: string;
  author_id: string;
  matchup_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
};

export type Challenge = {
  id: string;
  league_id: string;
  challenger_id: string;
  opponent_id: string;
  proposition_type: "weekly_matchup_winner" | "higher_player_points" | "season_finish" | "custom";
  title: string;
  terms: string;
  stake_label: string;
  status: "proposed" | "accepted" | "declined" | "expired" | "locked" | "awaiting_result" | "resolved" | "payment_pending" | "disputed" | "settled" | "voided";
  terms_hash: string;
  accepted_at: string | null;
  locked_at: string | null;
  resolved_at: string | null;
  winner_id: string | null;
  stake_amount_cents: number | null;
  matchup_id: string | null;
  settlement_due_at: string | null;
  payment_marked_at: string | null;
  payment_marked_by: string | null;
  payment_reference: string | null;
  receipt_confirmed_at: string | null;
  receipt_confirmed_by: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  resolution_evidence: Record<string, unknown> | null;
  created_at: string;
};

export type LeagueProfile = {
  id: string;
  display_name: string;
  settlement_provider: "venmo" | "other" | null;
  settlement_handle: string | null;
  settlement_opt_in_at: string | null;
};

/* ---------------------------------------------------------------- pulse -- */
/** Shape of ff_league_pulse(league_id) — the commissioner dashboard payload. */

export type PulseCheck = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  fix: string;
};

export type PulseManager = {
  team_id: string;
  name: string;
  draft_slot: number | null;
  email: string | null;
  joined: boolean;
  invited: boolean;
  display_name: string | null;
  queued: number;
  roster: number;
  picks: number;
};

export type PulseJob = {
  name: string;
  schedule: string;
  active: boolean;
  last_run: string | null;
  last_status: string | null;
  healthy: boolean;
};

export type PulseWeek = {
  week: number;
  games: number;
  first_kick: string | null;
  last_kick: string | null;
  final: number;
};

export type PulseEvent = {
  id: string;
  type: string;
  headline: string;
  detail: string | null;
  created_at: string;
  actor: string | null;
};

export type Pulse = {
  league: {
    id: string;
    name: string;
    season: number;
    team_count: number;
    roster_slots: string[];
    commissioner_id: string | null;
    is_commissioner: boolean;
  };
  draft: {
    id: string;
    status: DraftStatus;
    rounds: number;
    pick_seconds: number;
    current_pick: number;
    pick_deadline: string | null;
    started_at: string | null;
    completed_at: string | null;
    picks_made: number;
    picks_total: number;
    order_set: boolean;
    teams_with_queue: number;
  } | null;
  managers: PulseManager[];
  checks: PulseCheck[];
  readiness: { passed: number; total: number; pct: number };
  data: {
    players: number;
    adp: number;
    byes: number;
    games: number;
    last_stats_at: string | null;
    last_ingest_at: string | null;
    jobs: PulseJob[];
  };
  season: { week: number; next_kickoff: string | null; calendar: PulseWeek[] };
  clubhouse: { open_challenges: number; messages_7d: number };
  activity: PulseEvent[];
  generated_at: string;
};
