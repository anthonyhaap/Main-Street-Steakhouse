-- ============ Lineups, per-player lock, matchup scoring, standings ============

-- A player locks at HIS game's kickoff, not at some league-wide weekly deadline.
create or replace function ff_lock_time(p_player_id uuid, p_week int, p_season int default 2026)
returns timestamptz language sql stable security definer set search_path = public as $$
  select min(g.kickoff_at)
  from players p
  join nfl_games g
    on (g.home_team = p.nfl_team or g.away_team = p.nfl_team)
   and g.season = p_season and g.season_type = 2 and g.week = p_week
  where p.id = p_player_id
$$;

create or replace function ff_slot_ok(p_slot text, p_position text)
returns boolean language sql immutable as $$
  select case
    when p_slot = 'BN'   then true
    when p_slot = 'FLEX' then p_position in ('RB','WR','TE')
    else p_slot = p_position
  end
$$;

create or replace function ff_seed_rosters(p_league_id uuid, p_week int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_slots text[]; v_team record; v_slot text; v_pid uuid; v_draft uuid;
begin
  perform ff_assert_commissioner(p_league_id);
  select array(select jsonb_array_elements_text(roster_slots)) into v_slots
    from leagues where id = p_league_id;
  select id into v_draft from drafts where league_id = p_league_id;

  for v_team in select id from teams where league_id = p_league_id loop
    delete from rosters where team_id = v_team.id and week = p_week;

    foreach v_slot in array v_slots loop
      if v_slot = 'BN' then continue; end if;
      select p.id into v_pid
      from draft_picks dp
      join players p on p.id = dp.player_id
      left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format='ppr'
      where dp.draft_id = v_draft and dp.team_id = v_team.id
        and ff_slot_ok(v_slot, p.position)
        and not exists (select 1 from rosters r
                        where r.team_id = v_team.id and r.week = p_week and r.player_id = p.id)
      order by a.adp nulls last limit 1;

      if v_pid is not null then
        insert into rosters (team_id, player_id, week, slot, locked_at)
        values (v_team.id, v_pid, p_week, v_slot, ff_lock_time(v_pid, p_week));
      end if;
    end loop;

    insert into rosters (team_id, player_id, week, slot, locked_at)
    select v_team.id, dp.player_id, p_week, 'BN', ff_lock_time(dp.player_id, p_week)
    from draft_picks dp
    where dp.draft_id = v_draft and dp.team_id = v_team.id
      and not exists (select 1 from rosters r
                      where r.team_id = v_team.id and r.week = p_week and r.player_id = dp.player_id);
  end loop;

  return (select count(*) from rosters r join teams t on t.id = r.team_id
          where t.league_id = p_league_id and r.week = p_week);
end; $$;

create or replace function ff_set_lineup(p_team_id uuid, p_week int, p_assignments jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_league uuid; v_n int := 0; k text; v_slot text; v_pid uuid; v_pos text; v_lock timestamptz;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  if auth.uid() is not null and not exists (
    select 1 from teams t join leagues l on l.id = t.league_id
    where t.id = p_team_id and (t.owner_id = auth.uid() or l.commissioner_id = auth.uid())
  ) then raise exception 'not your team'; end if;

  for k in select jsonb_object_keys(p_assignments) loop
    v_pid  := k::uuid;
    v_slot := p_assignments->>k;
    select position into v_pos from players where id = v_pid;
    if not ff_slot_ok(v_slot, v_pos) then
      raise exception '% cannot play in the % slot', v_pos, v_slot;
    end if;
    select locked_at into v_lock from rosters
     where team_id = p_team_id and week = p_week and player_id = v_pid;
    if v_lock is not null and v_lock <= now() then
      raise exception 'that player is locked - his game has already kicked off';
    end if;
    update rosters set slot = v_slot
     where team_id = p_team_id and week = p_week and player_id = v_pid;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

create or replace view roster_points as
select r.team_id, r.week, r.slot, r.player_id, r.locked_at,
       p.full_name, p.position, p.nfl_team, t.league_id,
       coalesce(ff_score(sl.stats, ff_rules_for_week(t.league_id, r.week)), 0) as points,
       sl.updated_at as stats_updated_at
from rosters r
join teams t   on t.id = r.team_id
join players p on p.id = r.player_id
left join player_stat_lines sl
  on sl.player_id = r.player_id and sl.week = r.week
 and sl.season = 2026 and sl.season_type = 2 and sl.source = 'sleeper';

-- Recompute a week's matchup totals from starters. Pure function of stored
-- stats + the ruleset in force that week, so it is safe to run any time.
create or replace function ff_recompute_week(p_league_id uuid, p_week int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with pts as (
    select team_id, sum(points) as total from roster_points
    where league_id = p_league_id and week = p_week and slot <> 'BN'
    group by team_id
  )
  update matchups m
     set home_points = coalesce((select total from pts where team_id = m.home_team_id), 0),
         away_points = coalesce((select total from pts where team_id = m.away_team_id), 0)
   where m.league_id = p_league_id and m.week = p_week;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

create or replace view standings as
with results as (
  select league_id, week, home_team_id as team_id, home_points as pf, away_points as pa from matchups
  union all
  select league_id, week, away_team_id, away_points, home_points from matchups
)
select t.league_id, t.id as team_id, t.name,
       count(*) filter (where r.pf > r.pa and (r.pf + r.pa) > 0) as wins,
       count(*) filter (where r.pf < r.pa and (r.pf + r.pa) > 0) as losses,
       count(*) filter (where r.pf = r.pa and (r.pf + r.pa) > 0) as ties,
       round(coalesce(sum(r.pf), 0), 2) as points_for,
       round(coalesce(sum(r.pa), 0), 2) as points_against
from teams t
left join results r on r.team_id = t.id
group by t.league_id, t.id, t.name;

revoke execute on function ff_seed_rosters(uuid,int) from anon;
revoke execute on function ff_set_lineup(uuid,int,jsonb) from anon;
revoke execute on function ff_recompute_week(uuid,int) from anon;