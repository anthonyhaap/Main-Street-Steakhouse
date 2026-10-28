-- ============================================================================
-- A squeeze, told once a side.
--
-- `tightening` ("Toby cuts Mike's lead to 4.7 / Was down 18.2") was keyed by
-- the leader and the number of lead changes so far: once per lead. In a game
-- that changes hands every few minutes that re-armed after every flip, and
-- each time it said the same thing — "Was down" is the week's worst deficit
-- (`home_worst` / `away_worst`), which a flip does not change. Week 6 told one
-- comeback six times; week 7, one three times. Harmless in a feed, and a buzz
-- each time now that `gameday_push` sends it.
--
-- The key is now the matchup and the side that was behind: a side's climb back
-- is told once a week. The other side climbing back later is a different side
-- and is still told. Rows already written keep their old keys and are left as
-- they are.
--
-- `ff_sunday_swings` is restated in full from 20261002023710; only the
-- tightening dedupe key and its comment change; nothing else is touched.
-- ============================================================================

create or replace function public.ff_sunday_swings(p_league_id uuid, p_week integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league leagues%rowtype;
  v_week   integer;
  w        jsonb;
  v_n      integer := 0;
  v_k      integer;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then return 0; end if;
  v_week := greatest(1, coalesce(p_week, public.ff_current_week()));
  w      := public.ff_sunday_weights(p_league_id);

  -- A monster game: a starter's line, as the detector last saw it, past the
  -- mark. Joined to this week's lineup, so a man who was benched after an
  -- early look is not credited to the team that sat him.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, player_id,
                             new_score, opp_new_score, headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('monster:%s:%s:%s', v_week, ps.team_id, ps.player_id), 'monster_game', 3,
         (w->>'league_high')::int + (w->>'touchdown')::int,
         m.id, ps.team_id,
         case when ps.team_id = m.home_team_id then m.away_team_id else m.home_team_id end,
         ps.player_id,
         case when ps.team_id = m.home_team_id then st.home_points else st.away_points end,
         case when ps.team_id = m.home_team_id then st.away_points else st.home_points end,
         left(p.full_name || ' — monster game', 200),
         to_char(ps.points, 'FM99990.0') || ' points for ' || public.ff_team_label(ps.team_id),
         jsonb_build_object(
           'who', public.ff_team_label(ps.team_id),
           'opp', public.ff_team_label(case when ps.team_id = m.home_team_id then m.away_team_id else m.home_team_id end),
           'points', ps.points, 'position', p.position, 'nfl_team', p.nfl_team)
    from sunday_player_state ps
    join players p on p.id = ps.player_id
    join rosters r on r.team_id = ps.team_id and r.player_id = ps.player_id and r.week = v_week and r.slot <> 'BN'
    join matchups m on m.league_id = p_league_id and m.week = v_week
                   and ps.team_id in (m.home_team_id, m.away_team_id)
    join sunday_matchup_state st on st.matchup_id = m.id
   where ps.league_id = p_league_id and ps.season = v_league.season and ps.week = v_week
     and ps.points >= (w->>'monster_points')::numeric
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- Getting interesting: the side behind was down by the mark at some point
  -- this week and is now within a score, with the game still to finish. Once
  -- per trailing side per week: the deficit it is told against is the week's
  -- worst, so telling it again after the next lead change says nothing new.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, new_score, opp_new_score,
                             headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('tight:%s:%s', s.matchup_id, x.trail_team), 'tightening', 3,
         (w->>'within5')::int + (w->>'comeback')::int / 2,
         s.matchup_id, x.trail_team, x.lead_team, x.trail_pts, x.lead_pts,
         public.ff_team_label(x.trail_team) || ' cuts ' || public.ff_team_label(x.lead_team)
           || '''s lead to ' || to_char(x.lead_pts - x.trail_pts, 'FM99990.0'),
         'Was down ' || to_char(x.worst, 'FM99990.0'),
         jsonb_build_object('who', public.ff_team_label(x.trail_team), 'opp', public.ff_team_label(x.lead_team),
                            'from', x.worst, 'to', x.lead_pts - x.trail_pts)
    from sunday_matchup_state s
    join matchups m on m.id = s.matchup_id
    cross join lateral (
      select case when s.leader = 'home' then m.away_team_id else m.home_team_id end as trail_team,
             case when s.leader = 'home' then m.home_team_id else m.away_team_id end as lead_team,
             case when s.leader = 'home' then s.away_points else s.home_points end  as trail_pts,
             case when s.leader = 'home' then s.home_points else s.away_points end  as lead_pts,
             case when s.leader = 'home' then s.away_worst  else s.home_worst  end  as worst
    ) x
   where m.league_id = p_league_id and m.week = v_week
     and s.leader is not null and not s.final_fired
     and x.lead_pts > x.trail_pts
     and x.lead_pts - x.trail_pts <= (w->>'close_margin')::numeric
     and x.worst >= (w->>'tightening_from')::numeric
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  return v_n;
end;
$fn$;

revoke all on function public.ff_sunday_swings(uuid, integer) from public, anon, authenticated;
