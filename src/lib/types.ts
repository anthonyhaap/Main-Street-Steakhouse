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
  /** The invite address. Shown only on the commissioner's invite screen. */
  owner_email: string | null;
  /** The person behind the team, as the commissioner typed it. */
  manager_name: string | null;
  /**
   * The manager's crest, as an object key inside the public `team-logos`
   * bucket — never a URL. `crestUrl()` turns it into one.
   */
  logo_path: string | null;
  draft_slot: number | null;
};

/** The keys the app reads out of leagues.settings. Anything else rides along. */
export type LeagueSettings = {
  regular_season_weeks?: number;
  playoff_teams?: number;
  playoff_byes?: number;
  playoff_weeks?: number[];
  trade_deadline_week?: number;
  waiver_type?: string;
  waiver_run_day?: string;
  keepers?: boolean;
};

/** One row of league_scoring_rules: a ruleset and the week it took effect. */
export type ScoringRuleSet = {
  id: string;
  effective_from_week: number;
  note: string | null;
  created_at: string;
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
  espn_id: string | null;
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
  /** Addresses his headshot on ESPN's CDN; a club abbreviation for a defense. */
  espn_id: string | null;
  injury_status: string | null;
  depth_chart_order: number | null;
  /** Season projection, priced with this league's rules. Null until the
      projection cron has run for a player nobody projects. */
  proj_total: number | null;
  /** Current week forward. Equal to the total before the season starts. */
  proj_remaining: number | null;
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
  manager_name: string | null;
};

/* -------------------------------------------------------------- outlook -- */
/** Shape of ff_playoff_outlook(league_id) — the inputs to the playoff sim. */

export type OutlookTeam = {
  id: string;
  name: string;
  manager_name: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  /** Every score posted so far, in week order. */
  scores: number[];
  /** Expected weekly output of the current starters. Null before rosters exist. */
  proj_ppg: number | null;
};

export type OutlookMatchup = {
  id: string;
  week: number;
  home_team_id: string;
  away_team_id: string;
  home_points: number;
  away_points: number;
  played: boolean;
};

export type Outlook = {
  week: number;
  regular_season_weeks: number;
  playoff_teams: number;
  playoff_byes: number;
  teams: OutlookTeam[];
  matchups: OutlookMatchup[];
  generated_at: string;
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
  /** For the badge's headshot. Null for players ESPN has no mapping for. */
  espn_id: string | null;
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
  /** Null on a house post: the league wrote it, not a manager. */
  author_id: string | null;
  kind: "manager" | "house";
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
