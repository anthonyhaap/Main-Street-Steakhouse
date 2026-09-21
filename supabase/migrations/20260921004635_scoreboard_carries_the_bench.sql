-- ============================================================================
-- The board carries the bench, not only the starters.
--
-- `ff_scoreboard` has always read `rosters` with `slot <> 'BN'` in the join,
-- so the browser never saw who was sitting. On the list page that was right:
-- a card is a comparison of two lineups and a bench on it is noise. On the
-- full-screen matchup it is the one question the screen could not answer —
-- "should he have started somebody else" is half of what a manager reads a
-- matchup for, and the only way to find out was to leave for /team.
--
-- So the join stops filtering and the aggregate does instead. Every number
-- this function already returned is computed from the starters and nothing
-- else, restated here with `filter (where r.slot <> 'BN')` on each one:
-- `points`, `proj`, `proj_left`, `yet_to_play`, `in_action`, `top` and the
-- `slots_filled` that `empty_slots` is derived from. A bench player must not
-- move a score, a projection, a win probability or a lineup-hole warning, and
-- with those filters he cannot.
--
-- The one new key is `bench`, per side: the same object the starters already
-- carry, ordered by position and then by name rather than by slot, since
-- every bench row's slot is the same word.
--
-- The row object itself was inlined in the aggregate before; it is now built
-- once in its own CTE and aggregated twice. Two copies of a nineteen-key
-- object that must stay identical is a diff waiting to go wrong.
--
-- Additive: one new key, sourced from rows this function already joined. The
-- membership guard, the scoring, the ordering of the cards and the grant do
-- not change. Restated from what is live — the copy 20260920191109 put there,
-- which already carries 20260909194727's `ff_seat_team` checks.
--
-- Restated in full, as always.
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
as $fn$
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
  -- A reader, not merely a request. See the header.
  if v_uid is null then raise exception 'sign in required'; end if;

  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week  := greatest(1, coalesce(p_week, public.ff_current_week()));
  v_rules := public.ff_rules_for_week(p_league_id, v_week);

  select * into v_team from teams where id = public.ff_seat_team(p_league_id, v_uid) limit 1;

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
           -- The same row the points above are scored from, this time whole:
           -- completions, carries, targets, whatever Sleeper filed for him
           -- this week. Null until he has a stat line at all.
           (select sl.stats
              from player_stat_lines sl
             where sl.player_id = r.player_id and sl.season = v_league.season
               and sl.season_type = 2 and sl.week = v_week and sl.source = 'sleeper') as stats,
           (select i.severity from nfl_injuries i where i.player_id = r.player_id limit 1) as severity,
           g.kickoff_at, g.status as game_status, g.status_detail as game_detail,
           case when g.home_team = p.nfl_team then g.away_team else g.home_team end as opponent,
           (g.home_team = p.nfl_team) as at_home
      from matchups m
      -- The bench comes through the join now and is separated in the
      -- aggregate below. Every number this function returns still counts
      -- starters only; see the header.
      join rosters r
        on r.week = v_week
       and r.team_id in (m.home_team_id, m.away_team_id)
      join players p on p.id = r.player_id
      left join nfl_games g
        on g.season = v_league.season and g.season_type = 2 and g.week = v_week
       and p.nfl_team in (g.home_team, g.away_team)
     where m.league_id = p_league_id and m.week = v_week
  ),
  -- One object per roster row, built once. The starters and the bench are the
  -- same nineteen keys; two inlined copies of them would drift.
  line as (
    select s.*, jsonb_build_object(
             'player_id', s.player_id, 'full_name', s.full_name, 'position', s.position,
             'nfl_team', s.nfl_team, 'slot', s.slot, 'espn_id', s.espn_id,
             'points', s.points, 'projection', s.projection, 'stats', s.stats,
             'kickoff_at', s.kickoff_at, 'game_status', s.game_status,
             'game_detail', s.game_detail, 'opponent', s.opponent, 'at_home', s.at_home,
             'severity', s.severity,
             'on_bye', coalesce(s.bye_week = v_week, false),
             -- Over once his game is; also over if he never had one.
             'final', coalesce(s.game_status = 'post', s.kickoff_at is null)
           ) as row
      from side s
  ),
  agg as (
    select r.matchup_id, r.team_id,
           jsonb_agg(r.row order by array_position(array['QB','RB','WR','TE','FLEX','K','DST'], r.slot),
                                    r.full_name)
             filter (where r.slot <> 'BN') as starters,
           -- Every bench row's slot is 'BN', so the slot cannot order them.
           -- Position does, in the same order the starters run in.
           jsonb_agg(r.row order by array_position(array['QB','RB','WR','TE','K','DST'], r.position),
                                    r.full_name)
             filter (where r.slot = 'BN') as bench,
           count(*) filter (where r.slot <> 'BN') as slots_filled,
           round(coalesce(sum(r.points) filter (where r.slot <> 'BN'), 0), 2) as points,
           round(coalesce(sum(r.projection) filter (where r.slot <> 'BN'), 0), 2) as proj,
           -- What is still to come: the projection of everyone who has not kicked.
           round(coalesce(sum(r.projection) filter (
             where r.slot <> 'BN' and (r.game_status is null or r.game_status = 'pre')), 0), 2) as proj_left,
           count(*) filter (where r.slot <> 'BN'
             and not coalesce(r.game_status = 'post', r.kickoff_at is null)) as yet_to_play,
           count(*) filter (where r.slot <> 'BN' and r.game_status = 'in') as in_action,
           (array_agg(jsonb_build_object(
              'full_name', r.full_name, 'position', r.position, 'nfl_team', r.nfl_team,
              'points', r.points, 'game_status', r.game_status)
            order by r.points desc, r.full_name)
            filter (where r.slot <> 'BN'))[1] as top
      from line r group by r.matchup_id, r.team_id
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
        -- What has been said about this game. The thread itself is a second
        -- call, made when somebody opens it.
        'talk', jsonb_build_object(
          'count', coalesce(talk.n, 0),
          'last', talk.last
        ),
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
          'bench', coalesce(ah.bench, '[]'::jsonb),
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
          'bench', coalesce(aa.bench, '[]'::jsonb),
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
    left join lateral (
      select count(*) as n,
             (array_agg(jsonb_build_object(
                'body', lm.body,
                'created_at', lm.created_at,
                'author', coalesce(t.manager_name, t.name, 'League manager'),
                'mine', (lm.author_id = v_uid))
              order by lm.created_at desc))[1] as last
        from league_messages lm
        left join teams t on t.id = public.ff_seat_team(p_league_id, lm.author_id)
       where lm.matchup_id = m.id
    ) talk on true
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
$fn$;

revoke all on function public.ff_scoreboard(uuid, integer) from public, anon;
grant execute on function public.ff_scoreboard(uuid, integer) to authenticated;
