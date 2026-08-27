create or replace view public.nfl_weeks with (security_invoker = true) as
select season, season_type, week, min(kickoff_at) as first_kick,
       max(kickoff_at) as last_kick, count(*)::int as games
from nfl_games group by season, season_type, week;

-- "Current week" means the week whose games people care about right now: the
-- one still in progress, and once its last game is done, the next one.
create or replace function public.ff_current_week() returns integer language sql stable as $$
  select coalesce(
    (select w.week from public.nfl_weeks w
      where w.season_type = 2 and now() < w.last_kick + interval '4 hours'
      order by w.week limit 1),
    (select max(w.week) from public.nfl_weeks w where w.season_type = 2), 1)
$$;
grant execute on function public.ff_current_week() to authenticated;
grant select on public.nfl_weeks to authenticated;
