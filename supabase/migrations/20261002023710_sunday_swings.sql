-- ============================================================================
-- Game Day 2.0: two more things the league talks about, written as events.
--
-- The game center's League Pulse and "What just happened" read two kinds of
-- line: what IS (the board, live) and what HAPPENED (`sunday_events`). Two
-- of the brief's moments are the second kind and the detector did not write
-- them yet:
--
--   monster_game   a starter past `monster_points` (default 30) — "Amon-Ra
--                  St. Brown, 31.7 for Trav". Once per player per team per
--                  week. The board can say "he has 31.7" any time; the event
--                  is what lets the recap, the history wall and a push
--                  notification say it happened, and when.
--
--   tightening     a side that was down by `tightening_from` (default 15) or
--                  more is now within `close_margin` — "Toby cuts Mike's lead
--                  to 4.7 / Was down 18.2". The deficit is the worst one the
--                  moments pass already keeps on `sunday_matchup_state`
--                  (home_worst / away_worst), so this needs no new memory.
--                  Once per lead: the key carries the leader and the number
--                  of lead changes so far, so a game that tightens, opens up
--                  and tightens again under the same leader is told once, and
--                  the next lead is a new story.
--
-- Same contract as the detector and the moments pass: run after both, every
-- minute in a game window, dedupe keys with `on conflict do nothing`, nothing
-- for a table the detector has not seeded, and service-only.
--
-- The two thresholds join the commissioner's dials (`ff_sunday_weight_bounds`
-- restated with two more rows; nothing else in it changes).
-- ============================================================================

alter table public.sunday_events drop constraint if exists sunday_events_event_type_check;
alter table public.sunday_events add constraint sunday_events_event_type_check
  check (event_type in ('touchdown','big_play','scoring','turnover','lead_change',
                        'close_game','upset_watch','red_zone','final',
                        'comeback','season_high',
                        'monster_game','tightening'));

-- ---------------------------------------------------------------- weights --

create or replace function public.ff_sunday_weight_bounds()
returns table (key text, dflt integer, lo integer, hi integer, kind text)
language sql
immutable
set search_path = public
as $$
  values
    -- The excitement score: what makes a table worth featuring.
    ('touchdown',        20, 0, 100, 'score'),
    ('lead_change',      35, 0, 100, 'score'),
    ('within5',          25, 0, 100, 'score'),
    ('within1',          40, 0, 100, 'score'),
    ('fourth_quarter',   15, 0, 100, 'score'),
    ('rivalry',          10, 0, 100, 'score'),
    ('upset',            15, 0, 100, 'score'),
    ('league_high',      10, 0, 100, 'score'),
    ('playoff',          15, 0, 100, 'score'),
    ('projected_close',  10, 0, 100, 'score'),
    ('standings',         8, 0, 100, 'score'),
    ('in_action',         2, 0, 20,  'score'),
    ('comeback',         30, 0, 100, 'score'),
    ('season_high',      25, 0, 100, 'score'),
    -- Thresholds: when something counts at all.
    ('big_play_points',   6, 2, 30,  'threshold'),
    ('scoring_points',    3, 1, 20,  'threshold'),
    ('close_margin',      5, 1, 20,  'threshold'),
    ('close_reset',       8, 2, 30,  'threshold'),
    ('upset_gap',         8, 2, 40,  'threshold'),
    ('comeback_points',  20, 5, 80,  'threshold'),
    ('monster_points',   30, 15, 80, 'threshold'),
    ('tightening_from',  15, 6, 60,  'threshold')
$$;

-- ----------------------------------------------------------------- swings --

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
  -- this week and is now within a score, with the game still to finish.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, new_score, opp_new_score,
                             headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('tight:%s:%s:%s', s.matchup_id, s.leader, s.lead_changes), 'tightening', 3,
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

comment on function public.ff_sunday_swings(uuid, integer) is
  'Service only. After the detector and the moments pass: monster games and deficits cut close, as events. Idempotent.';

-- Every league: the detector, the moments, then the swings.
create or replace function public.ff_sunday_detect_all()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league uuid; v_n integer := 0;
begin
  if not exists (select 1 from nfl_games g
                  where g.season_type = 2
                    and (g.status = 'in' or g.kickoff_at between now() - interval '8 hours' and now())) then
    return jsonb_build_object('ran', false, 'reason', 'no games in window');
  end if;

  for v_league in select id from leagues loop
    begin
      v_n := v_n + public.ff_sunday_detect(v_league);
      v_n := v_n + public.ff_sunday_moments(v_league);
      v_n := v_n + public.ff_sunday_swings(v_league);
    exception when others then
      -- One league's bad row must not stop the others, or the stats.
      insert into ingest_log (source, event, detail)
      values ('sunday', 'detect_failed', jsonb_build_object('league', v_league, 'error', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ran', true, 'events', v_n);
end;
$fn$;

revoke all on function public.ff_sunday_detect_all() from public, anon, authenticated;
