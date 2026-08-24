-- Row Level Security: enablement + policies, extracted live from ojhjrxolrsppircyrcff.
--
-- IMPORTANT: every policy below is SELECT-only and scoped to `authenticated`.
-- There are NO INSERT/UPDATE/DELETE policies anywhere, and RLS denies by
-- default, so direct table writes are impossible for both anon and
-- authenticated. All mutations must go through the SECURITY DEFINER ff_*
-- functions in 03_functions.sql. That is the intended design -- do not "fix"
-- it by adding write policies without understanding the function layer.
--
-- The `anon` role holds table-level SELECT grants but matches no policy, so
-- it reads zero rows.

ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_scoring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_adp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_id_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_stat_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- ingest_log has RLS enabled but no policy at all: service_role only.

CREATE POLICY draft_picks_read         ON public.draft_picks         FOR SELECT TO authenticated USING (true);
CREATE POLICY draft_queue_read         ON public.draft_queue         FOR SELECT TO authenticated USING (true);
CREATE POLICY drafts_read              ON public.drafts              FOR SELECT TO authenticated USING (true);
CREATE POLICY league_scoring_rules_read ON public.league_scoring_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY leagues_read             ON public.leagues             FOR SELECT TO authenticated USING (true);
CREATE POLICY matchups_read            ON public.matchups            FOR SELECT TO authenticated USING (true);
CREATE POLICY nfl_games_read           ON public.nfl_games           FOR SELECT TO authenticated USING (true);
CREATE POLICY nfl_teams_read           ON public.nfl_teams           FOR SELECT TO authenticated USING (true);
CREATE POLICY player_adp_read          ON public.player_adp          FOR SELECT TO authenticated USING (true);
CREATE POLICY player_id_map_read       ON public.player_id_map       FOR SELECT TO authenticated USING (true);
CREATE POLICY player_stat_lines_read   ON public.player_stat_lines   FOR SELECT TO authenticated USING (true);
CREATE POLICY players_read             ON public.players             FOR SELECT TO authenticated USING (true);
CREATE POLICY rosters_read             ON public.rosters             FOR SELECT TO authenticated USING (true);
CREATE POLICY teams_read               ON public.teams               FOR SELECT TO authenticated USING (true);
