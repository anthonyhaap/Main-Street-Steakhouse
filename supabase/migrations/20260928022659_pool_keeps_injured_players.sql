-- ============================================================================
-- draft_pool keeps the injured, and says each player once.
--
-- Two things were wrong with the pool the players list is drawn from.
--
-- 1. A player on injured reserve fell out of it. Sleeper marks a man on IR
--    "Inactive", our sync stores that as status 'INA', and the view kept only
--    'ACT'. So the day De'Zhaun Stribling and Jordan Mason went on IR they
--    vanished: released to the pool, but nowhere in it — not in Available, not
--    in Everyone, and ff_add_drop / ff_claim_waiver refuse anyone the pool does
--    not contain, so nobody could sign them either. The same was true of the
--    IR players still on rosters: A.J. Brown, Alec Pierce and the rest were
--    missing from Everyone while their owners had them.
--
--    An inactive player with an injury designation is a real NFL player a
--    manager may want to stash or cut, so he stays. An inactive player with no
--    designation at all is how Sleeper carries the long-gone and the junk rows
--    ("Duplicate Player", Eric Ebron, Levine Toilolo) — those stay out.
--
-- 2. Chris Manhertz was in it twice. player_id_map holds two ESPN ids for him,
--    and the join on it made a row for each. Two rows with one id is two React
--    rows with one key, and the players list left stale copies of him on the
--    screen through every search that followed — which is why "Mason" and
--    "Strib" both answered with a column of Manhertzes. The ESPN id is now one
--    lateral pick per player, so no player can appear twice however many ids
--    the map collects.
--
-- Columns, names and types are unchanged, so every reader keeps working.
-- ============================================================================

create or replace view public.draft_pool with (security_invoker = true) as
select p.id,
       p.full_name,
       p."position",
       p.nfl_team,
       p.status,
       a.adp,
       a.overall_rank,
       p.bye_week,
       rank() over (partition by p."position"
                    order by coalesce(a.overall_rank, 9999), p.full_name) as position_rank,
       m.source_id     as espn_id,
       p.injury_status,
       p.depth_chart_order,
       sp.points_total     as proj_total,
       sp.points_remaining as proj_remaining
  from players p
  left join player_adp a
    on a.player_id = p.id and a.season = 2026 and a.format = 'ppr' and a.teams = 12
  left join lateral (
         select mm.source_id
           from player_id_map mm
          where mm.player_id = p.id and mm.source in ('espn', 'espn_team')
          order by mm.source, mm.source_id
          limit 1
       ) m on true
  left join player_season_projections sp
    on sp.player_id = p.id and sp.season = 2026
 where p.sleeper_id is not null
   and (p.status = 'ACT' or (p.status = 'INA' and p.injury_status is not null));
