-- ============================================================================
-- A record waits for the week.
--
-- The standings called a matchup decided the moment anybody in it had scored:
-- `pf + pa > 0` was the whole test. It was written when every score in the
-- table was a finished week's, and it held until the first Thursday night of
-- 2026 — one game, sixteen starters between them, and by Friday morning five
-- matchups had a "winner", ten teams had a record and the table was sorted by
-- it. Nobody had won anything. The other fifteen games had not kicked off.
--
-- So the test is now the one every other screen already uses for "is the week
-- over": every game of the NFL week is final, or the last one kicked off four
-- hours ago (the margin ff_current_week has always used to move on). Points
-- still have to be on the board — a finished week that was never scored is
-- still "not played" rather than a tie — and a week in progress stays what it
-- is: a score, shown live on the scoreboard, and not yet a result.
--
-- One predicate, ff_week_final, and the four places that decide results read
-- it: the standings view, which every record on every screen comes from;
-- ff_all_games, which the history wall, the rivalry card and the briefing's
-- form line read; ff_playoff_outlook's `played` flag, which is what the
-- browser's playoff simulation and power rankings count; and the two places
-- inside ff_briefing that read matchups directly, the streak and Tuesday's
-- "last week" card. ff_scoreboard, ff_team_hub and ff_history change nothing
-- and inherit it.
--
-- ff_all_games, ff_playoff_outlook and ff_briefing are restated in full, from
-- the bodies production runs — which is 20260909194727's rewrite of them, so
-- the ownership checks read ff_seat_team, not the file they came from.
-- supabase/tests/co_owners.sql checks that on every replay; standings.sql
-- covers the rule itself.
-- ============================================================================

-- --------------------------------------------------------------- the rule --

-- Whether an NFL week is over: every game final, or four hours past the last
-- kickoff, the same margin ff_current_week moves on by. A week with no games
-- on record is not over — there is nothing for it to be over.
create or replace function public.ff_week_final(p_season integer, p_week integer)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select bool_and(g.status = 'post')
        or now() >= max(g.kickoff_at) + interval '4 hours'
      from nfl_games g
     where g.season = p_season and g.season_type = 2 and g.week = p_week), false)
$$;

revoke all on function public.ff_week_final(integer, integer) from public, anon;
grant execute on function public.ff_week_final(integer, integer) to authenticated;

comment on function public.ff_week_final(integer, integer) is
  'True once an NFL regular-season week is over: all games final, or four hours past the last kickoff. The one place a matchup becomes a result.';

-- ---------------------------------------------------------- the standings --
-- Restated in full; the change is the join to leagues for the season and the
-- week test in each half of `results`. Columns and their order are unchanged.
create or replace view public.standings with (security_invoker = true) as
with results as (
  select m.league_id, m.week, m.home_team_id as team_id, m.home_points as pf, m.away_points as pa
    from matchups m
    join leagues l on l.id = m.league_id
   where public.ff_week_final(l.season, m.week)
  union all
  select m.league_id, m.week, m.away_team_id, m.away_points, m.home_points
    from matchups m
    join leagues l on l.id = m.league_id
   where public.ff_week_final(l.season, m.week)
)
select t.league_id,
       t.id as team_id,
       t.name,
       count(*) filter (where r.pf > r.pa and r.pf + r.pa > 0) as wins,
       count(*) filter (where r.pf < r.pa and r.pf + r.pa > 0) as losses,
       count(*) filter (where r.pf = r.pa and r.pf + r.pa > 0) as ties,
       round(coalesce(sum(r.pf), 0), 2) as points_for,
       round(coalesce(sum(r.pa), 0), 2) as points_against,
       t.manager_name
  from teams t
  left join results r on r.team_id = t.id
 group by t.league_id, t.id, t.name, t.manager_name;

-- ----------------------------------------------------------- every game --

create or replace function public.ff_all_games(p_league_id uuid)
returns table (
  season integer, week integer, round text,
  home_manager text, away_manager text, home_team text, away_team text,
  home_points numeric, away_points numeric, played boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select h.season, h.week, h.round,
         h.home_manager, h.away_manager, h.home_team, h.away_team,
         h.home_points, h.away_points, true
    from league_history h
   where h.league_id = p_league_id
  union all
  select l.season, m.week,
         -- The last playoff week is the final and the one before it the
         -- semifinal, so this season's champion lands on the plaque the
         -- night the game is played, the same as an imported one.
         case when m.week <= r.reg       then 'regular'
              when m.week >= r.last_week then 'final'
              when m.week =  r.last_week - 1 then 'semifinal'
              else 'quarterfinal' end,
         coalesce(th.manager_name, th.name), coalesce(ta.manager_name, ta.name),
         th.name, ta.name,
         m.home_points, m.away_points,
         -- A result, not a score in progress: the week has to be over. Points
         -- alone said "played" the moment one starter's game kicked off.
         (public.ff_week_final(l.season, m.week) and m.home_points + m.away_points > 0)
    from matchups m
    join leagues l  on l.id = m.league_id
    join teams th   on th.id = m.home_team_id
    join teams ta   on ta.id = m.away_team_id
    cross join lateral (
      select coalesce((l.settings->>'regular_season_weeks')::int, 14) as reg,
             coalesce((select max(x::int) from jsonb_array_elements_text(l.settings->'playoff_weeks') x),
                      coalesce((l.settings->>'regular_season_weeks')::int, 14) + 3) as last_week
    ) r
   where m.league_id = p_league_id
$$;

-- Internal. ff_briefing and ff_history call it as their definer; a signed-up
-- stranger holding the league id must not be able to call it directly.
revoke all on function public.ff_all_games(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------- playoff outlook --

create or replace function public.ff_playoff_outlook(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_league   leagues%rowtype;
  v_uid      uuid := auth.uid();
  v_week     integer;
  v_left     integer;
  v_teams    jsonb;
  v_matchups jsonb;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if v_uid is not null
     and not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week := greatest(1, public.ff_current_week());
  -- Projection weeks from here to the end of the NFL regular season. A
  -- starter's remaining projection spread over these is his expected weekly
  -- output, byes included, which is exactly what a season simulation wants.
  v_left := greatest(1, 19 - v_week);

  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_teams
  from (
    select jsonb_build_object(
      'id',             t.id,
      'name',           t.name,
      'manager_name',   t.manager_name,
      'wins',           s.wins,
      'losses',         s.losses,
      'ties',           s.ties,
      'points_for',     s.points_for,
      'points_against', s.points_against,
      -- Every score this team has actually posted, for the variance. A week
      -- still being played is not a sample of a week.
      'scores', coalesce((
        select jsonb_agg(r.pf order by r.week)
          from (select m.week,
                       case when m.home_team_id = t.id then m.home_points else m.away_points end as pf
                  from matchups m
                 where m.league_id = p_league_id
                   and (m.home_team_id = t.id or m.away_team_id = t.id)
                   and public.ff_week_final(v_league.season, m.week)
                   and m.home_points + m.away_points > 0) r), '[]'::jsonb),
      -- What the current starters are expected to score per week. Null until
      -- rosters exist for this week, which the browser treats as "use the
      -- league average".
      'proj_ppg', (
        select round(sum(sp.points_remaining) / v_left, 2)
          from rosters r
          join player_season_projections sp
            on sp.player_id = r.player_id and sp.season = v_league.season
         where r.team_id = t.id and r.week = v_week and r.slot <> 'BN')
    ) as x
    from teams t
    join standings s on s.team_id = t.id
    where t.league_id = p_league_id
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           m.id,
           'week',         m.week,
           'home_team_id', m.home_team_id,
           'away_team_id', m.away_team_id,
           'home_points',  m.home_points,
           'away_points',  m.away_points,
           -- Matches the standings view: a game counts once its week is over
           -- and somebody scored in it.
           'played',       public.ff_week_final(v_league.season, m.week)
                           and m.home_points + m.away_points > 0
         ) order by m.week), '[]'::jsonb)
    into v_matchups
    from matchups m
   where m.league_id = p_league_id;

  return jsonb_build_object(
    'week',                 v_week,
    'regular_season_weeks', coalesce((v_league.settings->>'regular_season_weeks')::int, 14),
    'playoff_teams',        coalesce((v_league.settings->>'playoff_teams')::int, 6),
    'playoff_byes',         coalesce((v_league.settings->>'playoff_byes')::int, 0),
    'teams',                v_teams,
    'matchups',             v_matchups,
    'generated_at',         now()
  );
end $$;

revoke all on function public.ff_playoff_outlook(uuid) from public, anon;
grant execute on function public.ff_playoff_outlook(uuid) to authenticated;

comment on function public.ff_playoff_outlook(uuid) is
  'Members only. Standings, full schedule with played flags, and projected points per game for each team: the inputs to the playoff simulation on the standings page.';


-- ---------------------------------------------------------------- briefing --

create or replace function public.ff_briefing(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_league    leagues%rowtype;
  v_team      teams%rowtype;
  v_opp       teams%rowtype;
  v_mu        matchups%rowtype;
  v_week      integer;
  v_rules     jsonb;
  v_reg       integer;
  v_me        jsonb;
  v_draft     jsonb;
  v_matchup   jsonb;
  v_last      jsonb;
  v_games     jsonb;
  v_history   jsonb;
  v_standings jsonb;
  v_board     jsonb;
  v_lineup    jsonb;
  v_my_name   text;
  v_opp_name  text;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if v_uid is not null
     and not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week  := greatest(1, public.ff_current_week());
  v_rules := public.ff_rules_for_week(p_league_id, v_week);
  v_reg   := coalesce((v_league.settings->>'regular_season_weeks')::int, 14);

  select * into v_team from teams where id = public.ff_seat_team(p_league_id, v_uid) limit 1;

  -- ------------------------------------------------------------ standings --
  -- Seeded the way the standings page sorts: wins (a tie is half), then points.
  select coalesce(jsonb_agg(x order by (x->>'seed')::int), '[]'::jsonb) into v_standings
  from (
    select jsonb_build_object(
      'team_id', s.team_id, 'name', s.name, 'manager_name', s.manager_name,
      'logo_path', t.logo_path,
      'wins', s.wins, 'losses', s.losses, 'ties', s.ties,
      'points_for', s.points_for, 'points_against', s.points_against,
      'seed', row_number() over (order by s.wins + s.ties / 2.0 desc, s.points_for desc, s.name)
    ) as x
    from standings s join teams t on t.id = s.team_id
    where s.league_id = p_league_id
  ) q;

  -- ------------------------------------------------------------------- me --
  if v_team.id is not null then
    select jsonb_build_object(
      'team_id', v_team.id, 'name', v_team.name, 'manager_name', v_team.manager_name,
      'logo_path', v_team.logo_path, 'draft_slot', v_team.draft_slot,
      'wins', st.wins, 'losses', st.losses, 'ties', st.ties,
      'points_for', st.points_for, 'points_against', st.points_against,
      'seed', (select (x->>'seed')::int from jsonb_array_elements(v_standings) x
                where x->>'team_id' = v_team.id::text),
      'streak', public.ff_streak((
        select array_agg(case when pf > pa then 'W' when pf < pa then 'L' else 'T' end order by week desc)
          from (select m.week,
                       case when m.home_team_id = v_team.id then m.home_points else m.away_points end as pf,
                       case when m.home_team_id = v_team.id then m.away_points else m.home_points end as pa
                  from matchups m
                 where m.league_id = p_league_id and v_team.id in (m.home_team_id, m.away_team_id)
                   and public.ff_week_final(v_league.season, m.week)
                   and m.home_points + m.away_points > 0) r))
    ) into v_me
    from standings st where st.team_id = v_team.id;
  end if;

  -- ---------------------------------------------------------------- draft --
  select jsonb_build_object(
    'id', d.id, 'status', d.status, 'current_pick', d.current_pick,
    'pick_deadline', d.pick_deadline, 'picks_total', d.rounds * v_league.team_count,
    'on_clock_team_id', case when d.status = 'active' then public.ff_team_on_clock(d.id) end,
    'started_at', d.started_at, 'completed_at', d.completed_at
  ) into v_draft
  from drafts d where d.league_id = p_league_id order by d.started_at desc nulls last limit 1;

  -- ------------------------------------------------------------- calendar --
  -- The state of this week's NFL slate: what has kicked, what is in progress,
  -- when the next game is. The browser turns this into Tuesday/Sunday/Monday.
  select jsonb_build_object(
    'week', v_week,
    'first_kick', min(g.kickoff_at),
    'last_kick',  max(g.kickoff_at),
    'total',      count(*),
    'final',      count(*) filter (where g.status = 'post'),
    'in_progress', count(*) filter (where g.status = 'in'),
    'next_kickoff', min(g.kickoff_at) filter (where g.kickoff_at > now()),
    'last_final_at', max(g.updated_at) filter (where g.status = 'post')
  ) into v_games
  from nfl_games g
  where g.season = v_league.season and g.season_type = 2 and g.week = v_week;

  -- -------------------------------------------------------------- matchup --
  if v_team.id is not null then
    select * into v_mu from matchups m
     where m.league_id = p_league_id and m.week = v_week
       and v_team.id in (m.home_team_id, m.away_team_id);
  end if;

  if v_mu.id is not null then
    select * into v_opp from teams
     where id = case when v_mu.home_team_id = v_team.id then v_mu.away_team_id else v_mu.home_team_id end;

    -- Every starter on both sides, with this week's points, projection and the
    -- state of his real game. A starter whose game is not final still counts
    -- his projection: that is what the Monday-night line is written from.
    with side as (
      select r.team_id, r.player_id, r.slot,
             p.full_name, p.position, p.nfl_team, p.bye_week,
             (select max(x.source_id) from player_id_map x
               where x.player_id = r.player_id and x.source in ('espn','espn_team')) as espn_id,
             coalesce((select round(public.ff_score(sl.stats, v_rules), 2)
                         from player_stat_lines sl
                        where sl.player_id = r.player_id and sl.season = v_league.season
                          and sl.season_type = 2 and sl.week = v_week and sl.source = 'sleeper'), 0) as points,
             (select round(public.ff_score(pj.stats, v_rules), 2)
                from player_projections pj
               where pj.player_id = r.player_id and pj.season = v_league.season
                 and pj.season_type = 2 and pj.week = v_week and pj.source = 'sleeper') as projection,
             g.kickoff_at, g.status as game_status,
             case when g.home_team = p.nfl_team then g.away_team else g.home_team end as opponent
        from rosters r
        join players p on p.id = r.player_id
        left join nfl_games g
          on g.season = v_league.season and g.season_type = 2 and g.week = v_week
         and p.nfl_team in (g.home_team, g.away_team)
       where r.week = v_week and r.slot <> 'BN'
         and r.team_id in (v_mu.home_team_id, v_mu.away_team_id)
    ),
    rows_ as (
      select s.team_id,
             jsonb_agg(jsonb_build_object(
               'player_id', s.player_id, 'full_name', s.full_name, 'position', s.position,
               'nfl_team', s.nfl_team, 'slot', s.slot, 'espn_id', s.espn_id,
               'points', s.points, 'projection', s.projection,
               'kickoff_at', s.kickoff_at, 'game_status', s.game_status, 'opponent', s.opponent,
               'on_bye', coalesce(s.bye_week = v_week, false),
               -- Final once the game is over; also final if he has no game at all.
               'final', coalesce(s.game_status = 'post', s.kickoff_at is null)
             ) order by array_position(array['QB','RB','WR','TE','FLEX','K','DST'], s.slot), s.full_name) as starters,
             count(*) as n,
             round(coalesce(sum(s.projection), 0), 2) as proj,
             -- Projection still to come: starters whose game has not kicked.
             round(coalesce(sum(s.projection) filter (where s.game_status is null or s.game_status = 'pre'), 0), 2) as proj_left,
             round(coalesce(sum(s.points), 0), 2) as pts
        from side s group by s.team_id
    ),
    slots as (
      select count(*) as n from jsonb_array_elements_text(v_league.roster_slots) x where x <> 'BN'
    )
    select jsonb_build_object(
      'id', v_mu.id, 'week', v_week,
      'home', (v_mu.home_team_id = v_team.id),
      'my_points',  round(case when v_mu.home_team_id = v_team.id then v_mu.home_points else v_mu.away_points end, 2),
      'opp_points', round(case when v_mu.home_team_id = v_team.id then v_mu.away_points else v_mu.home_points end, 2),
      'my_proj',  coalesce((select proj from rows_ where team_id = v_team.id), 0),
      'opp_proj', coalesce((select proj from rows_ where team_id = v_opp.id), 0),
      'my_proj_left',  coalesce((select proj_left from rows_ where team_id = v_team.id), 0),
      'opp_proj_left', coalesce((select proj_left from rows_ where team_id = v_opp.id), 0),
      'my_starters',  coalesce((select starters from rows_ where team_id = v_team.id), '[]'::jsonb),
      'opp_starters', coalesce((select starters from rows_ where team_id = v_opp.id), '[]'::jsonb),
      'my_empty_slots', greatest(0, (select n from slots) - coalesce((select n from rows_ where team_id = v_team.id), 0)),
      'opponent', jsonb_build_object(
        'team_id', v_opp.id, 'name', v_opp.name, 'manager_name', v_opp.manager_name,
        'logo_path', v_opp.logo_path,
        'wins', st.wins, 'losses', st.losses, 'ties', st.ties,
        'seed', (select (x->>'seed')::int from jsonb_array_elements(v_standings) x
                  where x->>'team_id' = v_opp.id::text)
      )
    ) into v_matchup
    from standings st where st.team_id = v_opp.id;
  end if;

  -- ----------------------------------------------------------- last week --
  -- Tuesday's card: the most recent week with a result, mine and the league's.
  if v_team.id is not null then
    select jsonb_build_object(
      'week', m.week,
      'matchup_id', m.id,
      'my_points',  round(case when m.home_team_id = v_team.id then m.home_points else m.away_points end, 2),
      'opp_points', round(case when m.home_team_id = v_team.id then m.away_points else m.home_points end, 2),
      'opponent', jsonb_build_object('team_id', o.id, 'name', o.name, 'manager_name', o.manager_name, 'logo_path', o.logo_path),
      -- The whole week's results, for the recap that goes to the chat. By
      -- Tuesday ff_current_week has moved on, so this cannot be read off
      -- `board`, which is the week ahead.
      'board', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', m2.id, 'week', m2.week,
                 'home_team_id', m2.home_team_id, 'away_team_id', m2.away_team_id,
                 'home_points', round(m2.home_points, 2), 'away_points', round(m2.away_points, 2),
                 'home_proj', 0, 'away_proj', 0,
                 'mine', v_team.id in (m2.home_team_id, m2.away_team_id)
               ) order by (v_team.id in (m2.home_team_id, m2.away_team_id)) desc, m2.id), '[]'::jsonb)
          from matchups m2 where m2.league_id = p_league_id and m2.week = m.week
      ),
      'league_high', (
        select jsonb_build_object('team_id', t2.id, 'name', t2.name, 'manager_name', t2.manager_name, 'points', hi.pts)
          from (select m2.home_team_id as tid, m2.home_points as pts from matchups m2 where m2.league_id = p_league_id and m2.week = m.week
                union all
                select m2.away_team_id, m2.away_points from matchups m2 where m2.league_id = p_league_id and m2.week = m.week
                order by pts desc limit 1) hi
          join teams t2 on t2.id = hi.tid
      ),
      'my_week_rank', (
        select count(*) + 1
          from (select m2.home_points as pts from matchups m2 where m2.league_id = p_league_id and m2.week = m.week
                union all
                select m2.away_points from matchups m2 where m2.league_id = p_league_id and m2.week = m.week) w
         where w.pts > case when m.home_team_id = v_team.id then m.home_points else m.away_points end
      ),
      'top_scorer', (
        select jsonb_build_object('full_name', p.full_name, 'position', p.position, 'points', rp.points)
          from roster_points rp join players p on p.id = rp.player_id
         where rp.team_id = v_team.id and rp.week = m.week and rp.slot <> 'BN'
         order by rp.points desc limit 1
      )
    ) into v_last
    from matchups m
    join teams o on o.id = case when m.home_team_id = v_team.id then m.away_team_id else m.home_team_id end
    where m.league_id = p_league_id and v_team.id in (m.home_team_id, m.away_team_id)
      and public.ff_week_final(v_league.season, m.week)
      and m.home_points + m.away_points > 0
    order by m.week desc limit 1;
  end if;

  -- -------------------------------------------------------------- history --
  -- All-time against tonight's opponent, by manager name, with the streak and
  -- the last meeting. This is the line nobody else can write.
  if v_opp.id is not null then
    v_my_name  := coalesce(v_team.manager_name, v_team.name);
    v_opp_name := coalesce(v_opp.manager_name, v_opp.name);

    with g as (
      select a.season, a.week, a.round,
             case when a.home_manager = v_my_name then a.home_points else a.away_points end as my,
             case when a.home_manager = v_my_name then a.away_points else a.home_points end as theirs
        from public.ff_all_games(p_league_id) a
       where a.played
         and ((a.home_manager = v_my_name and a.away_manager = v_opp_name)
           or (a.home_manager = v_opp_name and a.away_manager = v_my_name))
    ),
    ordered as (
      select *, case when my > theirs then 'W' when my < theirs then 'L' else 'T' end as k
        from g
    )
    select jsonb_build_object(
      'wins',   count(*) filter (where k = 'W'),
      'losses', count(*) filter (where k = 'L'),
      'ties',   count(*) filter (where k = 'T'),
      'games',  count(*),
      'streak', public.ff_streak((select array_agg(k order by season desc, week desc) from ordered)),
      'last', (select jsonb_build_object('season', season, 'week', week, 'round', round,
                                         'my', my, 'theirs', theirs, 'won', my > theirs)
                 from ordered order by season desc, week desc limit 1),
      'playoff_meetings', count(*) filter (where round <> 'regular'),
      'seasons_on_file', (select count(distinct season) from league_history where league_id = p_league_id)
    ) into v_history
    from ordered;
  else
    select jsonb_build_object(
      'seasons_on_file', (select count(distinct season) from league_history where league_id = p_league_id)
    ) into v_history;
  end if;

  -- ---------------------------------------------------------------- board --
  -- The week's other tables, for the carousel, with both projections.
  select coalesce(jsonb_agg(x order by (x->>'mine')::boolean desc, x->>'id'), '[]'::jsonb) into v_board
  from (
    select jsonb_build_object(
      'id', m.id, 'week', m.week,
      'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
      'home_points', round(m.home_points, 2), 'away_points', round(m.away_points, 2),
      'home_proj', (select round(coalesce(sum(public.ff_score(pj.stats, v_rules)), 0), 2)
                      from rosters r join player_projections pj on pj.player_id = r.player_id
                       and pj.season = v_league.season and pj.season_type = 2 and pj.week = v_week and pj.source = 'sleeper'
                     where r.team_id = m.home_team_id and r.week = v_week and r.slot <> 'BN'),
      'away_proj', (select round(coalesce(sum(public.ff_score(pj.stats, v_rules)), 0), 2)
                      from rosters r join player_projections pj on pj.player_id = r.player_id
                       and pj.season = v_league.season and pj.season_type = 2 and pj.week = v_week and pj.source = 'sleeper'
                     where r.team_id = m.away_team_id and r.week = v_week and r.slot <> 'BN'),
      'mine', (v_team.id is not null and v_team.id in (m.home_team_id, m.away_team_id))
    ) as x
    from matchups m
    where m.league_id = p_league_id and m.week = v_week
  ) q;

  -- --------------------------------------------------------------- lineup --
  -- What the Thursday nag is about: empty slots, byes and hurt starters.
  if v_team.id is not null then
    with slots as (
      select count(*) as n from jsonb_array_elements_text(v_league.roster_slots) x where x <> 'BN'
    ),
    st as (
      select r.player_id, p.full_name, p.bye_week, p.status,
             (select i.severity from nfl_injuries i where i.player_id = r.player_id limit 1) as severity
        from rosters r join players p on p.id = r.player_id
       where r.team_id = v_team.id and r.week = v_week and r.slot <> 'BN'
    )
    select jsonb_build_object(
      'starters', (select count(*) from st),
      'slots', (select n from slots),
      'empty_slots', greatest(0, (select n from slots) - (select count(*) from st)),
      'on_bye', coalesce((select jsonb_agg(full_name) from st where bye_week = v_week), '[]'::jsonb),
      'hurt', coalesce((select jsonb_agg(jsonb_build_object('full_name', full_name, 'severity', severity))
                          from st where severity in ('out','doubtful','questionable')), '[]'::jsonb),
      'has_roster', exists (select 1 from rosters r where r.team_id = v_team.id and r.week = v_week)
    ) into v_lineup;
  end if;

  return jsonb_build_object(
    'league', jsonb_build_object(
      'id', v_league.id, 'name', v_league.name, 'season', v_league.season,
      'team_count', v_league.team_count,
      'regular_season_weeks', v_reg,
      'playoff_teams', coalesce((v_league.settings->>'playoff_teams')::int, 6),
      'playoff_byes',  coalesce((v_league.settings->>'playoff_byes')::int, 0),
      'waiver_run_day', coalesce(v_league.settings->>'waiver_run_day', 'wednesday'),
      'is_commissioner', (v_league.commissioner_id = v_uid)
    ),
    'week',      v_week,
    'me',        v_me,
    'draft',     v_draft,
    'games',     v_games,
    'matchup',   v_matchup,
    'last',      v_last,
    'history',   v_history,
    'standings', v_standings,
    'board',     v_board,
    'lineup',    v_lineup,
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'manager_name', t.manager_name, 'logo_path', t.logo_path
              ) order by t.draft_slot), '[]'::jsonb) from teams t where t.league_id = p_league_id),
    'now',          now(),
    'generated_at', now()
  );
end $$;

revoke all on function public.ff_briefing(uuid) from public, anon;
grant execute on function public.ff_briefing(uuid) to authenticated;

comment on function public.ff_briefing(uuid) is
  'Members only. Everything the home screen says in one call: my matchup with live and projected totals and each starter''s game state, my record and seed, all-time head-to-head against tonight''s opponent, last week''s result, the week''s slate, lineup problems, and the NFL calendar the day-of-week personality is decided from.';

