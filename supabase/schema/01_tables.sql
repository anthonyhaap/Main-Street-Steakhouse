-- Tables and constraints in schema public, extracted live from ojhjrxolrsppircyrcff.
-- Row counts at time of extraction are noted for orientation.

-- players: 1264 rows
CREATE TABLE IF NOT EXISTS public.players (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  first_name text,
  last_name text,
  "position" text NOT NULL,
  nfl_team text,
  status text DEFAULT 'ACT'::text,
  bye_week integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  gsis_id text,
  sleeper_id text
);
ALTER TABLE public.players ADD CONSTRAINT players_pkey PRIMARY KEY (id);
ALTER TABLE public.players ADD CONSTRAINT players_gsis_id_key UNIQUE (gsis_id);
ALTER TABLE public.players ADD CONSTRAINT players_sleeper_id_key UNIQUE (sleeper_id);
ALTER TABLE public.players ADD CONSTRAINT players_nfl_team_fkey FOREIGN KEY (nfl_team) REFERENCES nfl_teams(id);

-- nfl_teams: 32 rows
CREATE TABLE IF NOT EXISTS public.nfl_teams (
  id text NOT NULL,
  name text NOT NULL,
  espn_id text
);
ALTER TABLE public.nfl_teams ADD CONSTRAINT nfl_teams_pkey PRIMARY KEY (id);
ALTER TABLE public.nfl_teams ADD CONSTRAINT nfl_teams_espn_id_key UNIQUE (espn_id);

-- leagues: 1 row
CREATE TABLE IF NOT EXISTS public.leagues (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  season integer NOT NULL DEFAULT 2026,
  commissioner_id uuid,
  team_count integer NOT NULL DEFAULT 12,
  scoring_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  roster_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.leagues ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);
ALTER TABLE public.leagues ADD CONSTRAINT leagues_commissioner_id_fkey FOREIGN KEY (commissioner_id) REFERENCES auth.users(id);

-- teams: 12 rows. owner_email is how an invited manager is matched to their
-- account on first login (see ff_link_me).
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL,
  name text NOT NULL,
  owner_id uuid,
  draft_slot integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  owner_email text
);
ALTER TABLE public.teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
ALTER TABLE public.teams ADD CONSTRAINT teams_league_id_draft_slot_key UNIQUE (league_id, draft_slot);
ALTER TABLE public.teams ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE public.teams ADD CONSTRAINT teams_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);

-- drafts: 1 row
CREATE TABLE IF NOT EXISTS public.drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL,
  status draft_status NOT NULL DEFAULT 'setup'::draft_status,
  type text NOT NULL DEFAULT 'snake'::text,
  rounds integer NOT NULL DEFAULT 16,
  pick_seconds integer NOT NULL DEFAULT 90,
  current_pick integer NOT NULL DEFAULT 1,
  pick_deadline timestamp with time zone,
  remaining_ms integer,
  started_at timestamp with time zone,
  completed_at timestamp with time zone
);
ALTER TABLE public.drafts ADD CONSTRAINT drafts_pkey PRIMARY KEY (id);
ALTER TABLE public.drafts ADD CONSTRAINT drafts_league_id_key UNIQUE (league_id);
ALTER TABLE public.drafts ADD CONSTRAINT drafts_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;

-- draft_picks: 0 rows -- the draft has never been run
CREATE TABLE IF NOT EXISTS public.draft_picks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  pick_number integer NOT NULL,
  round integer NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  is_autopick boolean NOT NULL DEFAULT false,
  made_by uuid,
  made_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_pkey PRIMARY KEY (id);
ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_draft_id_pick_number_key UNIQUE (draft_id, pick_number);
ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_draft_id_player_id_key UNIQUE (draft_id, player_id);
ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE;
ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_made_by_fkey FOREIGN KEY (made_by) REFERENCES auth.users(id);
ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);
ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);

-- draft_queue: 0 rows
CREATE TABLE IF NOT EXISTS public.draft_queue (
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  rank integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_pkey PRIMARY KEY (team_id, player_id);
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

-- rosters: 0 rows
CREATE TABLE IF NOT EXISTS public.rosters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  week integer NOT NULL,
  slot text NOT NULL,
  locked_at timestamp with time zone
);
ALTER TABLE public.rosters ADD CONSTRAINT rosters_pkey PRIMARY KEY (id);
ALTER TABLE public.rosters ADD CONSTRAINT rosters_team_id_week_player_id_key UNIQUE (team_id, week, player_id);
ALTER TABLE public.rosters ADD CONSTRAINT rosters_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);
ALTER TABLE public.rosters ADD CONSTRAINT rosters_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

-- matchups: 84 rows (full 12-team schedule)
CREATE TABLE IF NOT EXISTS public.matchups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL,
  week integer NOT NULL,
  home_team_id uuid NOT NULL,
  away_team_id uuid NOT NULL,
  home_points numeric NOT NULL DEFAULT 0,
  away_points numeric NOT NULL DEFAULT 0
);
ALTER TABLE public.matchups ADD CONSTRAINT matchups_pkey PRIMARY KEY (id);
ALTER TABLE public.matchups ADD CONSTRAINT matchups_league_id_week_home_team_id_key UNIQUE (league_id, week, home_team_id);
ALTER TABLE public.matchups ADD CONSTRAINT matchups_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES teams(id);
ALTER TABLE public.matchups ADD CONSTRAINT matchups_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES teams(id);
ALTER TABLE public.matchups ADD CONSTRAINT matchups_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;

-- league_scoring_rules: 1 row. Rules are versioned by effective_from_week so a
-- mid-season scoring change does not retroactively rescore earlier weeks.
CREATE TABLE IF NOT EXISTS public.league_scoring_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL,
  effective_from_week integer NOT NULL,
  rules jsonb NOT NULL,
  note text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.league_scoring_rules ADD CONSTRAINT league_scoring_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.league_scoring_rules ADD CONSTRAINT league_scoring_rules_league_id_effective_from_week_key UNIQUE (league_id, effective_from_week);
ALTER TABLE public.league_scoring_rules ADD CONSTRAINT league_scoring_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.league_scoring_rules ADD CONSTRAINT league_scoring_rules_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE public.league_scoring_rules ADD CONSTRAINT league_scoring_rules_effective_from_week_check CHECK (((effective_from_week >= 1) AND (effective_from_week <= 18)));

-- nfl_games: 272 rows (full 2026 regular season)
CREATE TABLE IF NOT EXISTS public.nfl_games (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  espn_event_id text NOT NULL,
  season integer NOT NULL,
  season_type integer NOT NULL,
  week integer NOT NULL,
  home_team text,
  away_team text,
  kickoff_at timestamp with time zone,
  status text,
  status_detail text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.nfl_games ADD CONSTRAINT nfl_games_pkey PRIMARY KEY (id);
ALTER TABLE public.nfl_games ADD CONSTRAINT nfl_games_espn_event_id_key UNIQUE (espn_event_id);
ALTER TABLE public.nfl_games ADD CONSTRAINT nfl_games_away_team_fkey FOREIGN KEY (away_team) REFERENCES nfl_teams(id);
ALTER TABLE public.nfl_games ADD CONSTRAINT nfl_games_home_team_fkey FOREIGN KEY (home_team) REFERENCES nfl_teams(id);

-- player_stat_lines: 5247 rows
CREATE TABLE IF NOT EXISTS public.player_stat_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  game_id uuid,
  season integer NOT NULL,
  season_type integer NOT NULL,
  week integer NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'sleeper'::text,
  ref_points numeric
);
ALTER TABLE public.player_stat_lines ADD CONSTRAINT player_stat_lines_pkey PRIMARY KEY (id);
ALTER TABLE public.player_stat_lines ADD CONSTRAINT player_stat_lines_week_key UNIQUE (player_id, season, season_type, week, source);
ALTER TABLE public.player_stat_lines ADD CONSTRAINT player_stat_lines_game_id_fkey FOREIGN KEY (game_id) REFERENCES nfl_games(id) ON DELETE CASCADE;
ALTER TABLE public.player_stat_lines ADD CONSTRAINT player_stat_lines_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

-- player_adp: 258 rows
CREATE TABLE IF NOT EXISTS public.player_adp (
  player_id uuid NOT NULL,
  format text NOT NULL,
  teams integer NOT NULL,
  season integer NOT NULL,
  adp numeric,
  overall_rank integer,
  snapshot_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.player_adp ADD CONSTRAINT player_adp_pkey PRIMARY KEY (player_id, format, teams, season);
ALTER TABLE public.player_adp ADD CONSTRAINT player_adp_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

-- player_id_map: 2336 rows (sleeper/gsis/etc -> internal uuid)
CREATE TABLE IF NOT EXISTS public.player_id_map (
  player_id uuid NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL
);
ALTER TABLE public.player_id_map ADD CONSTRAINT player_id_map_pkey PRIMARY KEY (source, source_id);
ALTER TABLE public.player_id_map ADD CONSTRAINT player_id_map_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

-- ingest_log: 16 rows. RLS enabled with no policy -> service_role only.
CREATE TABLE IF NOT EXISTS public.ingest_log (
  id bigint NOT NULL DEFAULT nextval('ingest_log_id_seq'::regclass),
  source text NOT NULL,
  event text NOT NULL,
  detail jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.ingest_log ADD CONSTRAINT ingest_log_pkey PRIMARY KEY (id);
