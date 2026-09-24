-- ============================================================================
-- ff_position_ranks — where a player stands at his position, league-wide.
--
-- The lineup used to say "WR2 of 5": his place in his own club's pecking
-- order. That answers "who is ahead of him in Dallas", which is the depth
-- chart's question and the player card still asks it. It does not answer the
-- one a manager is actually weighing on a Saturday — how good has he been, as
-- a fantasy player, against every other receiver in football.
--
-- So: every player at a position who has a stat line in the form season,
-- scored with this league's rules, ranked by season points. "WR14 of 212".
--
-- A separate call rather than a change to ff_team_hub, on purpose. The hub's
-- body in production is 20260909194727's in-place rewrite of it, not any file
-- in this directory, and restating it from a file would put back the
-- owner_id-only guard that locks co-owners out. This touches nothing else.
--
-- The form season is chosen exactly as the hub chooses it — this season once
-- it has stat lines, otherwise the last one that does — so the rank and the
-- form column beside it are always about the same games.
-- ============================================================================

create or replace function public.ff_position_ranks(
  p_league_id  uuid,
  p_week       integer default null,
  p_player_ids uuid[]  default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_league leagues%rowtype;
  v_week   integer;
  v_rules  jsonb;
  v_form   integer;
  v_ranks  jsonb;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  -- auth.uid() IS NULL is the service-role escape hatch, matching ff_team_hub.
  if auth.uid() is not null and not public.ff_is_member(p_league_id) then
    raise exception 'not a member of this league';
  end if;

  v_week  := coalesce(p_week, public.ff_current_week());
  v_rules := public.ff_rules_for_week(v_league.id, v_week);

  select max(season) into v_form
    from player_stat_lines
   where season_type = 2 and season <= v_league.season;

  with totals as (
    select sl.player_id, p.position,
           count(*)                                               as games,
           round(sum(public.ff_score(sl.stats, v_rules)), 2)      as points
      from player_stat_lines sl
      join players p on p.id = sl.player_id
     where sl.season = v_form and sl.season_type = 2 and sl.source = 'sleeper'
     group by sl.player_id, p.position
  ),
  ranked as (
    select t.*,
           rank()   over (partition by t.position order by t.points desc) as pos_rank,
           count(*) over (partition by t.position)                        as pos_of
      from totals t
  )
  select coalesce(jsonb_object_agg(r.player_id, jsonb_build_object(
           'rank',   r.pos_rank,
           'of',     r.pos_of,
           'points', r.points,
           'games',  r.games)), '{}'::jsonb)
    into v_ranks
    from ranked r
   where p_player_ids is null or r.player_id = any (p_player_ids);

  return jsonb_build_object(
    'season', v_form,
    'ranks',  v_ranks
  );
end $$;

revoke all on function public.ff_position_ranks(uuid, integer, uuid[]) from public, anon;
grant execute on function public.ff_position_ranks(uuid, integer, uuid[]) to authenticated;

comment on function public.ff_position_ranks(uuid, integer, uuid[]) is
  'Each player''s fantasy rank at his position across the whole NFL, by form-season points in this league''s scoring. Keyed by player id; p_player_ids narrows the answer, never the ranking.';
