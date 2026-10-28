-- ============================================================================
-- No pick only counts against you if there was a pick to make.
--
-- Week 1 kicked off and finished before Pick'em existed — nobody in the
-- league could have picked any of it. ff_pickem_weekly_standings didn't know
-- that: "the game is final and there is no pick" fired the same way whether
-- the whole league skipped a game or the whole league never had the feature.
-- Every manager came out of week 1 with a wall of incorrects for games he
-- never had a chance to call.
--
-- The fix asks one more question before grading a missing pick: did *anyone*
-- in the league pick anything at all this week? If not, the week reads as
-- ungraded — everyone 0 correct, 0 incorrect, the games sit in "remaining" —
-- rather than as a week everyone lost. A wrong pick still counts wrong
-- regardless: that only happens when a pick exists, which already proves the
-- week was live. Once the league is actually using Pick'em for a week, a
-- manager who skips one game is back to being graded on it exactly as
-- before — this only excuses a week nobody could have played.
-- ============================================================================

create or replace function public.ff_pickem_weekly_standings(p_league_id uuid, p_season integer, p_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  return coalesce((
    with games as (
      select g.id, g.status, g.kickoff_at,
             case when g.status = 'post' and g.home_score is not null and g.away_score is not null
                  then case when g.home_score > g.away_score then g.home_team
                            when g.away_score > g.home_score then g.away_team end
                  end as winner
        from nfl_games g
       where g.season = p_season and g.season_type = 2 and g.week = p_week
    ),
    week_active as (
      select exists (
        select 1 from pickem_picks pp
        join nfl_games g on g.id = pp.game_id
       where pp.league_id = p_league_id and g.season = p_season and g.season_type = 2 and g.week = p_week
      ) as active
    ),
    graded as (
      select m.user_id, m.display_name,
             sum(case when games.winner is not null and pp.selected_team = games.winner
                      then 1 else 0 end) as correct,
             sum(case
                   -- a real pick that missed: always incorrect, activity or not
                   when pp.selected_team is not null and games.winner is not null
                        and pp.selected_team <> games.winner
                     then 1
                   -- no pick: only counts against you once the league has shown
                   -- it was actually picking this week
                   when pp.selected_team is null and (select active from week_active)
                        and (games.winner is not null
                             or (games.status <> 'post' and games.kickoff_at <= now()))
                     then 1
                   else 0
                 end) as incorrect
        from public.ff_pickem_members(p_league_id) m
        cross join games
        left join pickem_picks pp on pp.game_id = games.id and pp.user_id = m.user_id
       group by m.user_id, m.display_name
    ),
    ranked as (
      select *, (select count(*) from games) - (correct + incorrect) as remaining,
             rank() over (order by correct desc, incorrect asc, display_name asc) as rnk
        from graded
    )
    select jsonb_agg(jsonb_build_object(
             'user_id', user_id, 'display_name', display_name,
             'correct', correct, 'incorrect', incorrect, 'remaining', remaining,
             'win_pct', case when correct + incorrect = 0 then 0
                             else round(100.0 * correct / (correct + incorrect), 1) end,
             'mine', user_id = v_uid, 'rank', rnk
           ) order by rnk)
      from ranked
  ), '[]'::jsonb);
end $$;

revoke execute on function public.ff_pickem_weekly_standings(uuid, integer, integer) from public, anon;
grant execute on function public.ff_pickem_weekly_standings(uuid, integer, integer) to authenticated, service_role;
