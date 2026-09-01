/** Shapes shared by the database that assembles NFL context and the pages that draw it. */

/* ------------------------------------------------------------------ hub -- */
/** The payload of `ff_team_hub(team_id, week)`. */

export type HubGame = {
  opponent: string;
  home: boolean;
  kickoff_at: string;
  status: string | null;
  status_detail: string | null;
};

export type Usage = Partial<{
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

/** Season counting stats, as they would read on the back of a card. */
export type Totals = Partial<{
  rush_att: number; rush_yd: number; rush_td: number;
  rec_tgt: number; rec: number; rec_yd: number; rec_td: number;
  pass_att: number; pass_cmp: number; pass_yd: number; pass_td: number;
  pass_int: number; fum_lost: number;
  fgm: number; fga: number; sack: number;
}>;

export type SeasonLine = {
  season: number;
  games: number;
  points: number;
  avg_points: number;
  last3_avg: number | null;
  best: number;
  worst: number;
  /** Standard deviation of weekly scores — how much of a coin flip he is. */
  swing: number;
  booms: number;
  busts: number;
  game_log: { week: number; points: number }[];
  usage: Usage;
  totals: Totals;
};

/** The lighter season summary the team hub carries per roster row. */
export type HubForm = {
  season: number;
  games: number;
  avg_points: number;
  last3_avg: number | null;
  best: number;
  worst: number;
  total: number;
  swing: number;
  booms: number;
  busts: number;
  game_log: { week: number; points: number }[];
  usage: Usage;
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
  /** What he is projected to score this week, in our scoring. Null before the
      projections load, or for a player nobody projects. */
  projection: number | null;
  projected_at: string | null;
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
    projected_starters: number;
    by_position: { position: string; players: number; points: number; avg_form: number | null }[];
  };
  generated_at: string;
};

/* ----------------------------------------------------------------- wire -- */
/**
 * Rows of `nfl_news` and `nfl_injuries`, loaded from ESPN by pg_cron.
 *
 * The injury row carries `player_id` because the loader resolves it: matching a
 * report to a roster is a foreign key here, not string-matching in a browser.
 */

export type WireArticle = {
  id: string;
  headline: string;
  description: string | null;
  published_at: string | null;
  url: string | null;
  byline: string | null;
  image_url: string | null;
  image_alt: string | null;
  athletes: { id: string; name: string }[];
  teams: string[];
};

export type InjurySeverity = "out" | "doubtful" | "questionable" | "probable" | "unknown";

export type WireInjury = {
  id: string;
  espn_athlete_id: string | null;
  player_id: string | null;
  name: string;
  position: string | null;
  team: string | null;
  /** ESPN's wording: "Out", "Questionable", "Injured Reserve"… */
  status: string;
  /** Our coarse bucket, decided once in SQL. */
  severity: InjurySeverity;
  detail: string | null;
  location: string | null;
  comment: string | null;
  return_date: string | null;
  reported_at: string | null;
};

export type Wire = {
  articles: WireArticle[];
  injuries: WireInjury[];
  /** When the cron last wrote either table; null until it has run. */
  fetchedAt: string | null;
};

/* ------------------------------------------------------------ player -- */
/** The payload of `ff_player_card(player_id, week)`. */

export type CardPlayer = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string;
  nfl_team: string | null;
  status: string | null;
  bye_week: number | null;
  jersey: number | null;
  age: number | null;
  birth_date: string | null;
  height_in: number | null;
  weight_lb: number | null;
  college: string | null;
  high_school: string | null;
  years_exp: number | null;
  rookie_year: number | null;
  depth_chart_order: number | null;
  depth_chart_pos: string | null;
  espn_id: string | null;
  sleeper_id: string | null;
};

export type Projection = {
  week: number;
  points: number;
  source_ppr: number | null;
  stats: Record<string, number>;
  updated_at: string;
};

export type DepthSlot = {
  player_id: string;
  name: string;
  order: number | null;
  injury_status: string | null;
  is_this_player: boolean;
  avg_points: number | null;
};

export type PlayerCard = {
  player: CardPlayer;
  league: { season: number; name: string };
  week: number;
  game: HubGame | null;
  injury: {
    status: string; severity: InjurySeverity; detail: string | null;
    location: string | null; comment: string | null;
    return_date: string | null; reported_at: string | null;
  } | null;
  this_season: SeasonLine | null;
  last_season: SeasonLine | null;
  projections: Projection[];
  rest_of_season: number;
  depth_chart: DepthSlot[];
  news: (Omit<WireArticle, "athletes" | "teams"> & { byline: string | null })[];
  roster_spot: { team_id: string; team_name: string; slot: string } | null;
  market: { adp: number | null; overall_rank: number | null } | null;
  generated_at: string;
};
