-- Every player had bye_week = NULL, which makes a draft board actively
-- misleading. Derive byes from the loaded schedule: the one week in 1..18 where
-- a team has no game.

create or replace function public.ff_backfill_bye_weeks(p_season int)
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  with byes as (
    select t.id as team_id, w.week as bye
    from nfl_teams t
    cross join generate_series(1, 18) as w(week)
    where not exists (
      select 1 from nfl_games g
      where g.season = p_season and g.season_type = 2 and g.week = w.week
        and (g.home_team = t.id or g.away_team = t.id))
      and exists (
      select 1 from nfl_games g
      where g.season = p_season and g.season_type = 2
        and (g.home_team = t.id or g.away_team = t.id))
  ),
  single as (select team_id, min(bye) as bye from byes group by team_id having count(*) = 1)
  update players p set bye_week = s.bye, updated_at = now()
    from single s
   where p.nfl_team = s.team_id and p.bye_week is distinct from s.bye;
  get diagnostics v_n = row_count;
  insert into ingest_log (source, event, detail)
  values ('schedule', 'bye_weeks_backfilled', jsonb_build_object('season', p_season, 'players', v_n));
  return v_n;
end;
$fn$;

revoke all on function public.ff_backfill_bye_weeks(int) from public, anon;
select public.ff_backfill_bye_weeks(2026);
