-- ============================================================================
-- Faces on the scoreboard.
--
-- `roster_points` is what /matchups reads to fill in each side's lineup. It
-- carried the name, the slot and the points, so the one screen everybody has
-- open on a Sunday was the only place in the app where a player was a string
-- rather than a face you can click.
--
-- The ESPN id is one join away, exactly as it already is for `draft_pool` and
-- `draft_board`. Same left join, same source filter, so a player with no
-- mapping comes back null and the badge falls back to a monogram.
--
-- Column order and every existing name are unchanged; this only appends.
-- ============================================================================

create or replace view public.roster_points with (security_invoker = true) as
select r.team_id,
       r.week,
       r.slot,
       r.player_id,
       r.locked_at,
       p.full_name,
       p."position",
       p.nfl_team,
       t.league_id,
       coalesce(ff_score(sl.stats, ff_rules_for_week(t.league_id, r.week)), 0::numeric) as points,
       sl.updated_at as stats_updated_at,
       m.source_id   as espn_id
  from rosters r
  join teams t   on t.id = r.team_id
  join players p on p.id = r.player_id
  left join player_stat_lines sl
    on sl.player_id = r.player_id
   and sl.week = r.week
   and sl.season = 2026
   and sl.season_type = 2
   and sl.source = 'sleeper'::text
  left join player_id_map m
    on m.player_id = p.id and m.source in ('espn', 'espn_team');
