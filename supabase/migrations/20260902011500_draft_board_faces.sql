-- ============================================================================
-- Faces on the board.
--
-- `draft_board` is what the grid of picks reads. It named the player and his
-- club and stopped there, so a completed board was a wall of text you had to
-- read rather than a room you could scan. The ESPN id is one join away and the
-- grid cell has room for an eighteen-pixel crest.
--
-- Column order and every existing name are unchanged; this only appends.
-- ============================================================================

create or replace view public.draft_board with (security_invoker = true) as
select dp.draft_id,
       dp.pick_number,
       dp.round,
       dp.is_autopick,
       dp.made_at,
       t.id   as team_id,
       t.name as team_name,
       t.draft_slot,
       p.id   as player_id,
       p.full_name as player_name,
       p."position",
       p.nfl_team,
       m.source_id as espn_id
  from draft_picks dp
  join teams t   on t.id = dp.team_id
  join players p on p.id = dp.player_id
  left join player_id_map m
    on m.player_id = p.id and m.source in ('espn', 'espn_team');
