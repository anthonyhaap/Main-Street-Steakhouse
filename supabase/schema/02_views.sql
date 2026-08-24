-- Views in schema public, extracted live from project ojhjrxolrsppircyrcff.
-- These four are flagged SECURITY DEFINER by the Supabase linter; they run with
-- the creator's permissions rather than the caller's. Left as-is because the
-- underlying tables are RLS-protected and the app depends on them today.

CREATE OR REPLACE VIEW public.draft_board AS
 SELECT dp.draft_id, dp.pick_number, dp.round, dp.is_autopick, dp.made_at,
    t.id AS team_id, t.name AS team_name, t.draft_slot,
    p.id AS player_id, p.full_name AS player_name, p."position", p.nfl_team
   FROM draft_picks dp
     JOIN teams t ON t.id = dp.team_id
     JOIN players p ON p.id = dp.player_id;

CREATE OR REPLACE VIEW public.draft_pool AS
 SELECT p.id, p.full_name, p."position", p.nfl_team, p.status, a.adp, a.overall_rank
   FROM players p
     LEFT JOIN player_adp a ON a.player_id = p.id AND a.season = 2026
       AND a.format = 'ppr'::text AND a.teams = 12
  WHERE p.status = 'ACT'::text AND p.sleeper_id IS NOT NULL;

CREATE OR REPLACE VIEW public.roster_points AS
 SELECT r.team_id, r.week, r.slot, r.player_id, r.locked_at,
    p.full_name, p."position", p.nfl_team, t.league_id,
    COALESCE(ff_score(sl.stats, ff_rules_for_week(t.league_id, r.week)), 0::numeric) AS points,
    sl.updated_at AS stats_updated_at
   FROM rosters r
     JOIN teams t ON t.id = r.team_id
     JOIN players p ON p.id = r.player_id
     LEFT JOIN player_stat_lines sl ON sl.player_id = r.player_id AND sl.week = r.week
       AND sl.season = 2026 AND sl.season_type = 2 AND sl.source = 'sleeper'::text;

CREATE OR REPLACE VIEW public.standings AS
 WITH results AS (
         SELECT league_id, week, home_team_id AS team_id, home_points AS pf, away_points AS pa FROM matchups
        UNION ALL
         SELECT league_id, week, away_team_id, away_points, home_points FROM matchups
        )
 SELECT t.league_id, t.id AS team_id, t.name,
    count(*) FILTER (WHERE r.pf > r.pa AND (r.pf + r.pa) > 0::numeric) AS wins,
    count(*) FILTER (WHERE r.pf < r.pa AND (r.pf + r.pa) > 0::numeric) AS losses,
    count(*) FILTER (WHERE r.pf = r.pa AND (r.pf + r.pa) > 0::numeric) AS ties,
    round(COALESCE(sum(r.pf), 0::numeric), 2) AS points_for,
    round(COALESCE(sum(r.pa), 0::numeric), 2) AS points_against
   FROM teams t
     LEFT JOIN results r ON r.team_id = t.id
  GROUP BY t.league_id, t.id, t.name;
