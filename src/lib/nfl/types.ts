/** Shapes shared by the server that fetches NFL context and the page that draws it. */

/* ------------------------------------------------------------------ hub -- */
/** The payload of `ff_team_hub(team_id, week)`. */

export type HubGame = {
  opponent: string;
  home: boolean;
  kickoff_at: string;
  status: string | null;
  status_detail: string | null;
};

export type HubUsage = Partial<{
  snap_pct: number;
  carries: number;
  targets: number;
  catches: number;
  rush_yds: number;
  rec_yds: number;
  pass_yds: number;
  pass_att: number;
  tds: number;
  turnovers: number;
  fg_made: number;
  sacks: number;
}>;

export type HubForm = {
  season: number;
  games: number;
  avg_points: number;
  last3_avg: number | null;
  best: number;
  worst: number;
  total: number;
  /** Standard deviation of weekly scores — how much of a coin flip he is. */
  swing: number;
  booms: number;
  busts: number;
  game_log: { week: number; points: number }[];
  usage: HubUsage;
};

export type HubPlayer = {
  player_id: string;
  full_name: string;
  position: string;
  nfl_team: string | null;
  slot: string;
  status: string | null;
  bye_week: number | null;
  locked_at: string | null;
  /** Evaluated in server time, not the browser's. */
  locked: boolean;
  espn_id: string | null;
  sleeper_id: string | null;
  points: number;
  stats_updated_at: string | null;
  on_bye: boolean;
  game: HubGame | null;
  depth: { rank: number | null; of: number | null; overall_rank: number | null; adp: number | null };
  form: HubForm | null;
};

export type TeamHub = {
  team: { id: string; name: string; league_id: string; owner_email: string | null; draft_slot: number | null };
  league: { id: string; name: string; season: number; roster_slots: string[]; current_week: number };
  week: number;
  form_season: number | null;
  roster: HubPlayer[];
  record: {
    wins: number; losses: number; ties: number;
    points_for: number; points_against: number; rank: number; teams: number;
  } | null;
  matchup: {
    id: string; home: boolean; my_points: number; opp_points: number;
    opponent: { id: string; name: string; record: { wins: number; losses: number; ties: number } | null };
  } | null;
  splits: {
    starter_points: number;
    bench_points: number;
    by_position: { position: string; players: number; points: number; avg_form: number | null }[];
  };
  generated_at: string;
};

/* ----------------------------------------------------------------- wire -- */
/** Normalised NFL news and injury reports, as served by /api/nfl/wire. */

export type WireArticle = {
  id: string;
  headline: string;
  description: string;
  published: string | null;
  url: string | null;
  byline: string | null;
  image: { url: string; alt: string } | null;
  /** ESPN athlete ids the story is filed under — how we match it to a roster. */
  athletes: { id: string; name: string }[];
  /** Our club abbreviations. */
  teams: string[];
};

export type WireInjury = {
  id: string;
  espnId: string | null;
  name: string;
  position: string | null;
  team: string | null;
  /** "Out", "Questionable", "Injured Reserve"… as ESPN words it. */
  status: string;
  /** Our own coarse bucket, so styling and logic don't parse prose. */
  severity: "out" | "doubtful" | "questionable" | "probable" | "unknown";
  detail: string | null;
  comment: string | null;
  returnDate: string | null;
  updated: string | null;
};

export type Wire = {
  fetchedAt: string;
  articles: WireArticle[];
  injuries: WireInjury[];
  /** Which feeds answered. A partial wire still renders; a dead one says so. */
  sources: { name: string; ok: boolean; error?: string }[];
};
