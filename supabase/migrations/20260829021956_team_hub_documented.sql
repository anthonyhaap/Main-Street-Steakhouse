-- ============================================================================
-- ff_team_hub — one call that tells a manager everything about their team.
--
-- The My Team page used to render a lineup and nothing else: a slot, a name, a
-- number. Everything a manager actually decides with — how the guy has been
-- used, who he plays this week, whether the room around him just changed — was
-- somewhere else or nowhere at all. This function is that context, assembled in
-- one round trip so the page never waterfalls.
--
-- Returns: the roster (starters and bench) with per-player season form, usage
-- rates, depth-chart position and this week's NFL game; the team's record,
-- league rank and head-to-head matchup; and per-position splits.
--
-- Two decisions worth naming:
--
--   * Points are always scored with *this league's* rules for the requested
--     week (ff_rules_for_week), including the historical game log. A 2025 stat
--     line is therefore shown as what it would have been worth to us, not as
--     whatever some other site's PPR setting made of it.
--
--   * Form comes from the most recent season that actually has stat lines.
--     In August the 2026 column is empty and last season is the only honest
--     answer, so the payload names the season it used and lets the UI say so.
--
-- SECURITY DEFINER for a stable search_path and one membership check on entry;
-- every table it touches is already readable by members. auth.uid() IS NULL is
-- the service-role escape hatch, matching ff_league_pulse.
-- ============================================================================

create or replace function public.ff_team_hub(p_team_id uuid, p_week integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_team     teams%rowtype;
  v_league   leagues%rowtype;
  v_week     integer;
  v_rules    jsonb;
  v_season   integer;      -- the league's season (this week's games)
  v_form     integer;      -- the season form/usage is drawn from
  v_roster   jsonb;
  v_matchup  jsonb;
  v_record   jsonb;
  v_splits   jsonb;
begin
  select * into v_team from teams where id = p_team_id;
  if not found then raise exception 'team not found'; end if;

  select * into v_league from leagues where id = v_team.league_id;
  if not found then raise exception 'league not found'; end if;

  if v_uid is not null
     and not exists (select 1 from teams where league_id = v_team.league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_season := v_league.season;
  v_week   := coalesce(p_week, public.ff_current_week());
  v_rules  := public.ff_rules_for_week(v_league.id, v_week);

  -- Prefer this season once it has stat lines; fall back to the last one that
  -- does. Null means the table is empty and every form field comes back null.
  select max(season) into v_form
    from player_stat_lines
   where season_type = 2 and season <= v_season;

  -- ------------------------------------------------------------- roster --
  with mine as (
    select r.player_id, r.slot, r.locked_at,
           p.full_name, p.position, p.nfl_team, p.status, p.bye_week, p.sleeper_id
      from rosters r
      join players p on p.id = r.player_id
     where r.team_id = p_team_id and r.week = v_week
  ),
  -- ESPN ids are how a roster row is matched to a headshot, a news story and
  -- an injury report. Team defenses map to their club's abbreviation instead.
  ids as (
    select m.player_id,
           max(case when x.source in ('espn','espn_team') then x.source_id end) as espn_id
      from mine m
      left join player_id_map x on x.player_id = m.player_id
     group by m.player_id
  ),
  -- Every stat line the player has in the form season, scored our way.
  log as (
    select sl.player_id, sl.week, sl.stats,
           round(public.ff_score(sl.stats, v_rules), 2) as pts
      from player_stat_lines sl
      join mine m on m.player_id = sl.player_id
     where sl.season = v_form and sl.season_type = 2 and sl.source = 'sleeper'
  ),
  form as (
    select l.player_id,
           count(*)                                     as games,
           round(avg(l.pts), 2)                         as avg_points,
           round(max(l.pts), 2)                         as best,
           round(min(l.pts), 2)                         as worst,
           round(sum(l.pts), 2)                         as total,
           round(coalesce(stddev_samp(l.pts), 0), 2)    as swing,
           count(*) filter (where l.pts >= 15)          as booms,
           count(*) filter (where l.pts < 5)            as busts,
           jsonb_agg(jsonb_build_object('week', l.week, 'points', l.pts) order by l.week) as game_log,
           -- Per-game usage. These are the numbers that actually move when the
           -- room around a player changes, which is the whole point of showing
           -- them next to the injury wire.
           jsonb_strip_nulls(jsonb_build_object(
             'snap_pct',  round(avg(case when nullif((l.stats->>'tm_off_snp')::numeric, 0) is not null
                                    then 100 * coalesce((l.stats->>'off_snp')::numeric, 0)
                                         / (l.stats->>'tm_off_snp')::numeric end), 1),
             'carries',   round(avg(coalesce((l.stats->>'rush_att')::numeric, 0)), 1),
             'targets',   round(avg(coalesce((l.stats->>'rec_tgt')::numeric, 0)), 1),
             'catches',   round(avg(coalesce((l.stats->>'rec')::numeric, 0)), 1),
             'rush_yds',  round(avg(coalesce((l.stats->>'rush_yd')::numeric, 0)), 1),
             'rec_yds',   round(avg(coalesce((l.stats->>'rec_yd')::numeric, 0)), 1),
             'pass_yds',  round(avg(coalesce((l.stats->>'pass_yd')::numeric, 0)), 1),
             'pass_att',  round(avg(coalesce((l.stats->>'pass_att')::numeric, 0)), 1),
             'tds',       round(avg(coalesce((l.stats->>'pass_td')::numeric, 0)
                                  + coalesce((l.stats->>'rush_td')::numeric, 0)
                                  + coalesce((l.stats->>'rec_td')::numeric, 0)), 2),
             'turnovers', round(avg(coalesce((l.stats->>'pass_int')::numeric, 0)
                                  + coalesce((l.stats->>'fum_lost')::numeric, 0)), 2),
             'fg_made',   round(avg(coalesce((l.stats->>'fgm')::numeric, 0)), 1),
             'sacks',     round(avg(coalesce((l.stats->>'sack')::numeric, 0)), 1)
           )) as usage
      from log l
     group by l.player_id
  ),
  -- Last three games, most recent first: the number managers argue about.
  recent as (
    select l.player_id,
           round(avg(l.pts), 2) as last3_avg
      from (
        select l.*, row_number() over (partition by l.player_id order by l.week desc) as rn
          from log l
      ) l
     where l.rn <= 3
     group by l.player_id
  ),
  -- Where a player sits in his own club's pecking order, by draft-market rank.
  -- "RB2 of 4 in DAL" is what turns an injury headline into a decision.
  depth as (
    select m.player_id,
           (select count(*) from players q
              left join player_adp qa on qa.player_id = q.id and qa.season = v_season
                                     and qa.format = 'ppr' and qa.teams = 12
             where q.nfl_team = m.nfl_team and q.position = m.position and q.status = 'ACT'
               and coalesce(qa.overall_rank, 9999) < coalesce(a.overall_rank, 9999)) + 1 as depth_rank,
           (select count(*) from players q
             where q.nfl_team = m.nfl_team and q.position = m.position and q.status = 'ACT') as depth_of,
           a.overall_rank, a.adp
      from mine m
      left join player_adp a on a.player_id = m.player_id and a.season = v_season
                            and a.format = 'ppr' and a.teams = 12
  ),
  -- This week's real NFL game: who, where, when, and whether it has kicked.
  game as (
    select m.player_id,
           case when g.home_team = m.nfl_team then g.away_team else g.home_team end as opponent,
           (g.home_team = m.nfl_team)                                               as home,
           g.kickoff_at, g.status, g.status_detail
      from mine m
      join nfl_games g
        on g.season = v_season and g.season_type = 2 and g.week = v_week
       and m.nfl_team in (g.home_team, g.away_team)
  ),
  -- This week's actual points, straight off the live stat line.
  week_pts as (
    select sl.player_id,
           round(public.ff_score(sl.stats, v_rules), 2) as points,
           sl.updated_at
      from player_stat_lines sl
      join mine m on m.player_id = sl.player_id
     where sl.season = v_season and sl.season_type = 2 and sl.week = v_week
       and sl.source = 'sleeper'
  )
  select coalesce(jsonb_agg(j order by j->>'full_name'), '[]'::jsonb)
    into v_roster
  from (
    select jsonb_build_object(
      'player_id',  m.player_id,
      'full_name',  m.full_name,
      'position',   m.position,
      'nfl_team',   m.nfl_team,
      'slot',       m.slot,
      'status',     m.status,
      'bye_week',   m.bye_week,
      'locked_at',  m.locked_at,
      -- Decided here, in server time. A manager whose laptop clock is forty
      -- seconds fast must not see a lineup he can no longer legally change.
      'locked',     coalesce(m.locked_at <= now(), false),
      'espn_id',    i.espn_id,
      'sleeper_id', m.sleeper_id,
      'points',     coalesce(w.points, 0),
      'stats_updated_at', w.updated_at,
      'on_bye',     coalesce(m.bye_week = v_week, false),
      'game', case when g.player_id is null then null else jsonb_build_object(
        'opponent',      g.opponent,
        'home',          g.home,
        'kickoff_at',    g.kickoff_at,
        'status',        g.status,
        'status_detail', g.status_detail
      ) end,
      'depth', jsonb_build_object(
        'rank',         d.depth_rank,
        'of',           d.depth_of,
        'overall_rank', d.overall_rank,
        'adp',          d.adp
      ),
      'form', case when f.player_id is null then null else jsonb_build_object(
        'season',     v_form,
        'games',      f.games,
        'avg_points', f.avg_points,
        'last3_avg',  r.last3_avg,
        'best',       f.best,
        'worst',      f.worst,
        'total',      f.total,
        'swing',      f.swing,
        'booms',      f.booms,
        'busts',      f.busts,
        'game_log',   f.game_log,
        'usage',      f.usage
      ) end
    ) as j
    from mine m
    left join ids      i on i.player_id = m.player_id
    left join form     f on f.player_id = m.player_id
    left join recent   r on r.player_id = m.player_id
    left join depth    d on d.player_id = m.player_id
    left join game     g on g.player_id = m.player_id
    left join week_pts w on w.player_id = m.player_id
  ) s;

  -- ------------------------------------------------------------- record --
  select jsonb_build_object(
    'wins',           s.wins,
    'losses',         s.losses,
    'ties',           s.ties,
    'points_for',     round(s.points_for, 2),
    'points_against', round(s.points_against, 2),
    'rank',           (select count(*) + 1 from standings o
                        where o.league_id = s.league_id
                          and (o.wins, o.points_for) > (s.wins, s.points_for)),
    'teams',          (select count(*) from teams where league_id = s.league_id)
  ) into v_record
  from standings s where s.team_id = p_team_id;

  -- ----------------------------------------------------------- matchup --
  select jsonb_build_object(
    'id',            mu.id,
    'home',          (mu.home_team_id = p_team_id),
    'my_points',     round(case when mu.home_team_id = p_team_id then mu.home_points else mu.away_points end, 2),
    'opp_points',    round(case when mu.home_team_id = p_team_id then mu.away_points else mu.home_points end, 2),
    'opponent', jsonb_build_object(
      'id',   o.id,
      'name', o.name,
      'record', (select jsonb_build_object('wins', st.wins, 'losses', st.losses, 'ties', st.ties)
                   from standings st where st.team_id = o.id)
    )
  ) into v_matchup
  from matchups mu
  join teams o on o.id = case when mu.home_team_id = p_team_id then mu.away_team_id else mu.home_team_id end
  where mu.league_id = v_league.id and mu.week = v_week
    and p_team_id in (mu.home_team_id, mu.away_team_id);

  -- ------------------------------------------------------------ splits --
  -- Points by position, starters vs bench: the two cuts that tell a manager
  -- where the week was won and how much of it stayed on the bench.
  select jsonb_build_object(
    'starter_points', coalesce(round(sum((r->>'points')::numeric) filter (where r->>'slot' <> 'BN'), 2), 0),
    'bench_points',   coalesce(round(sum((r->>'points')::numeric) filter (where r->>'slot' =  'BN'), 2), 0),
    'by_position', coalesce((
      select jsonb_agg(x order by x->>'position')
        from (
          select jsonb_build_object(
                   'position', r2->>'position',
                   'players',  count(*),
                   'points',   round(sum((r2->>'points')::numeric), 2),
                   'avg_form', round(avg((r2->'form'->>'avg_points')::numeric), 2)
                 ) as x
            from jsonb_array_elements(v_roster) r2
           where r2->>'slot' <> 'BN'
           group by r2->>'position'
        ) t
    ), '[]'::jsonb)
  ) into v_splits
  from jsonb_array_elements(v_roster) r;

  return jsonb_build_object(
    'team', jsonb_build_object(
      'id', v_team.id, 'name', v_team.name, 'league_id', v_team.league_id,
      'owner_email', v_team.owner_email, 'draft_slot', v_team.draft_slot
    ),
    'league', jsonb_build_object(
      'id', v_league.id, 'name', v_league.name, 'season', v_season,
      'roster_slots', v_league.roster_slots, 'current_week', public.ff_current_week()
    ),
    'week',         v_week,
    'form_season',  v_form,
    'roster',       coalesce(v_roster, '[]'::jsonb),
    'record',       v_record,
    'matchup',      v_matchup,
    'splits',       v_splits,
    'generated_at', now()
  );
end $$;

revoke all on function public.ff_team_hub(uuid, integer) from public;
grant execute on function public.ff_team_hub(uuid, integer) to authenticated;

comment on function public.ff_team_hub(uuid, integer) is
  'Everything the My Team page renders: roster with form, usage, depth and this week''s NFL game, plus record, matchup and position splits. One round trip.';
