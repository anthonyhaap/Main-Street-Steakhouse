-- ============================================================================
-- Sunday at the Steakhouse: one call behind the scoreboard.
--
-- `/matchups` was reading `matchups` and `roster_points` straight off the
-- tables, which is why the page could only ever show two names and two zeroes.
-- Everything that makes a fantasy scoreboard worth watching lives one join
-- further out: what each starter is projected to score, whether his game has
-- kicked, whether it is on right now, and how much of the lineup is still to
-- come. `ff_briefing` already assembles exactly that — for one matchup, the
-- caller's. This is the same assembly for the whole week's slate.
--
-- Additive: one new function. `ff_briefing` owns the home card and is
-- untouched, and nothing is dropped.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

create or replace function public.ff_scoreboard(p_league_id uuid, p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_league leagues%rowtype;
  v_team   teams%rowtype;
  v_week   integer;
  v_rules  jsonb;
  v_games  jsonb;
  v_rows   jsonb;
  v_stats  timestamptz;
  v_proj   timestamptz;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  -- Same door as ff_briefing: signup is open and the league id ships in the
  -- bundle, so membership is checked here rather than left to RLS.
  if v_uid is not null
     and not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week  := greatest(1, coalesce(p_week, public.ff_current_week()));
  v_rules := public.ff_rules_for_week(p_league_id, v_week);

  select * into v_team from teams where league_id = p_league_id and owner_id = v_uid limit 1;

  -- ------------------------------------------------------------- the slate --
  -- The NFL's week, not the league's: what has kicked, what is on now, when
  -- the next one starts. The browser turns this into "six games still to come".
  select jsonb_build_object(
    'week', v_week,
    'first_kick', min(g.kickoff_at),
    'last_kick',  max(g.kickoff_at),
    'total',      count(*),
    'final',      count(*) filter (where g.status = 'post'),
    'in_progress', count(*) filter (where g.status = 'in'),
    'next_kickoff', min(g.kickoff_at) filter (where g.kickoff_at > now())
  ) into v_games
  from nfl_games g
  where g.season = v_league.season and g.season_type = 2 and g.week = v_week;

  -- ------------------------------------------------------------ provenance --
  -- When the numbers on this screen were last written. A manager forgives a
  -- stale score far more readily than a score with no timestamp on it.
  select max(sl.updated_at) into v_stats
    from player_stat_lines sl
   where sl.season = v_league.season and sl.season_type = 2
     and sl.week = v_week and sl.source = 'sleeper';

  select max(pj.updated_at) into v_proj
    from player_projections pj
   where pj.season = v_league.season and pj.season_type = 2
     and pj.week = v_week and pj.source = 'sleeper';

  -- -------------------------------------------------------------- the week --
  with side as (
    select m.id as matchup_id, r.team_id, r.player_id, r.slot,
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
           (select i.severity from nfl_injuries i where i.player_id = r.player_id limit 1) as severity,
           g.kickoff_at, g.status as game_status, g.status_detail as game_detail,
           case when g.home_team = p.nfl_team then g.away_team else g.home_team end as opponent,
           (g.home_team = p.nfl_team) as at_home
      from matchups m
      join rosters r
        on r.week = v_week and r.slot <> 'BN'
       and r.team_id in (m.home_team_id, m.away_team_id)
      join players p on p.id = r.player_id
      left join nfl_games g
        on g.season = v_league.season and g.season_type = 2 and g.week = v_week
       and p.nfl_team in (g.home_team, g.away_team)
     where m.league_id = p_league_id and m.week = v_week
  ),
  agg as (
    select s.matchup_id, s.team_id,
           jsonb_agg(jsonb_build_object(
             'player_id', s.player_id, 'full_name', s.full_name, 'position', s.position,
             'nfl_team', s.nfl_team, 'slot', s.slot, 'espn_id', s.espn_id,
             'points', s.points, 'projection', s.projection,
             'kickoff_at', s.kickoff_at, 'game_status', s.game_status,
             'game_detail', s.game_detail, 'opponent', s.opponent, 'at_home', s.at_home,
             'severity', s.severity,
             'on_bye', coalesce(s.bye_week = v_week, false),
             -- Over once his game is; also over if he never had one.
             'final', coalesce(s.game_status = 'post', s.kickoff_at is null)
           ) order by array_position(array['QB','RB','WR','TE','FLEX','K','DST'], s.slot),
                      s.full_name) as starters,
           count(*) as slots_filled,
           round(coalesce(sum(s.points), 0), 2) as points,
           round(coalesce(sum(s.projection), 0), 2) as proj,
           -- What is still to come: the projection of everyone who has not kicked.
           round(coalesce(sum(s.projection) filter (
             where s.game_status is null or s.game_status = 'pre'), 0), 2) as proj_left,
           count(*) filter (where not coalesce(s.game_status = 'post', s.kickoff_at is null)) as yet_to_play,
           count(*) filter (where s.game_status = 'in') as in_action,
           (array_agg(jsonb_build_object(
              'full_name', s.full_name, 'position', s.position, 'nfl_team', s.nfl_team,
              'points', s.points, 'game_status', s.game_status)
            order by s.points desc, s.full_name))[1] as top
      from side s group by s.matchup_id, s.team_id
  ),
  slots as (
    select count(*) as n from jsonb_array_elements_text(v_league.roster_slots) x where x <> 'BN'
  ),
  card as (
    select
      (v_team.id is not null and v_team.id in (m.home_team_id, m.away_team_id)) as mine,
      th.name as sort_name,
      jsonb_build_object(
        'id', m.id, 'week', m.week,
        'mine', (v_team.id is not null and v_team.id in (m.home_team_id, m.away_team_id)),
        'home', jsonb_build_object(
          'team_id', th.id, 'name', th.name, 'manager_name', th.manager_name,
          'logo_path', th.logo_path,
          'wins', coalesce(sh.wins, 0), 'losses', coalesce(sh.losses, 0), 'ties', coalesce(sh.ties, 0),
          'points', round(m.home_points, 2),
          'proj', coalesce(ah.proj, 0), 'proj_left', coalesce(ah.proj_left, 0),
          'yet_to_play', coalesce(ah.yet_to_play, 0), 'in_action', coalesce(ah.in_action, 0),
          'empty_slots', greatest(0, (select n from slots) - coalesce(ah.slots_filled, 0)),
          'top', ah.top,
          'starters', coalesce(ah.starters, '[]'::jsonb),
          'mine', coalesce(v_team.id = m.home_team_id, false)
        ),
        'away', jsonb_build_object(
          'team_id', ta.id, 'name', ta.name, 'manager_name', ta.manager_name,
          'logo_path', ta.logo_path,
          'wins', coalesce(sa.wins, 0), 'losses', coalesce(sa.losses, 0), 'ties', coalesce(sa.ties, 0),
          'points', round(m.away_points, 2),
          'proj', coalesce(aa.proj, 0), 'proj_left', coalesce(aa.proj_left, 0),
          'yet_to_play', coalesce(aa.yet_to_play, 0), 'in_action', coalesce(aa.in_action, 0),
          'empty_slots', greatest(0, (select n from slots) - coalesce(aa.slots_filled, 0)),
          'top', aa.top,
          'starters', coalesce(aa.starters, '[]'::jsonb),
          'mine', coalesce(v_team.id = m.away_team_id, false)
        )
      ) as x
    from matchups m
    join teams th on th.id = m.home_team_id
    join teams ta on ta.id = m.away_team_id
    left join standings sh on sh.team_id = th.id
    left join standings sa on sa.team_id = ta.id
    left join agg ah on ah.matchup_id = m.id and ah.team_id = m.home_team_id
    left join agg aa on aa.matchup_id = m.id and aa.team_id = m.away_team_id
    where m.league_id = p_league_id and m.week = v_week
  )
  -- My game first; the rest in a fixed order, because a card that reorders
  -- itself under a thumb on a Sunday is worse than a card that is second.
  select coalesce(jsonb_agg(x order by mine desc, sort_name), '[]'::jsonb) into v_rows from card;

  return jsonb_build_object(
    'league', jsonb_build_object(
      'id', v_league.id, 'name', v_league.name, 'season', v_league.season,
      'team_count', v_league.team_count,
      'regular_season_weeks', coalesce((v_league.settings->>'regular_season_weeks')::int, 14),
      'roster_slots', v_league.roster_slots
    ),
    'week', v_week,
    'my_team_id', v_team.id,
    'games', v_games,
    'matchups', v_rows,
    'stats_updated_at', v_stats,
    'projections_updated_at', v_proj,
    'now', now(),
    'generated_at', now()
  );
end;
$$;
