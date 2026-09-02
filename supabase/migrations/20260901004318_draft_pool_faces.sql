-- ============================================================================
-- Faces in the player pool.
--
-- `draft_pool` backs the players list and the draft board — the two screens
-- where you are looking at names you don't know yet, and therefore the two that
-- benefit most from a photograph. The ESPN id that addresses a headshot is one
-- join away in `player_id_map`, and the injury designation the pool loader now
-- keeps is one column away in `players`.
--
-- Everything the view already returned is unchanged and in the same order, so
-- nothing reading it needs to know this happened.
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
       p.depth_chart_order
  from players p
  left join player_adp a
    on a.player_id = p.id and a.season = 2026 and a.format = 'ppr' and a.teams = 12
  left join player_id_map m
    on m.player_id = p.id and m.source in ('espn', 'espn_team')
 where p.status = 'ACT' and p.sleeper_id is not null;
