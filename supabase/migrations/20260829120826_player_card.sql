-- ============================================================================
-- ff_player_card — everything there is to know about one player, in one call.
--
-- A name in a lineup should be a door. Behind it a manager wants the same
-- things every time: who is this, what has he done, what is he expected to do,
-- who is ahead of him, and what is the wire saying. Those live in six tables;
-- assembling them in the browser would be six round trips and a waterfall.
--
-- Two seasons are returned, always, and always scored with this league's rules:
-- the current one because that is the argument, and the last completed one
-- because in August it is the only evidence there is. The card names both
-- seasons so the page never has to imply that 2025 numbers are this year's.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- One season of a player's scoring, priced our way. Extracted because the card
-- needs it twice and ff_team_hub wants the same arithmetic to mean the same
-- thing.
-- ----------------------------------------------------------------------------

create or replace function public.ff_player_season(
  p_player_id uuid, p_season integer, p_rules jsonb)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with log as (
    select sl.week, sl.stats, round(public.ff_score(sl.stats, p_rules), 2) as pts
      from player_stat_lines sl
     where sl.player_id = p_player_id and sl.season = p_season
       and sl.season_type = 2 and sl.source = 'sleeper'
  ),
  last3 as (
    select round(avg(pts), 2) as v from (
      select pts from log order by week desc limit 3
    ) t
  )
  select case when count(*) = 0 then null else jsonb_build_object(
    'season',     p_season,
    'games',      count(*),
    'points',     round(sum(pts), 2),
    'avg_points', round(avg(pts), 2),
    'last3_avg',  (select v from last3),
    'best',       round(max(pts), 2),
    'worst',      round(min(pts), 2),
    'swing',      round(coalesce(stddev_samp(pts), 0), 2),
    'booms',      count(*) filter (where pts >= 15),
    'busts',      count(*) filter (where pts < 5),
    'game_log',   jsonb_agg(jsonb_build_object('week', week, 'points', pts) order by week),
    'usage',      jsonb_strip_nulls(jsonb_build_object(
      'snap_pct',  round(avg(case when nullif((stats->>'tm_off_snp')::numeric, 0) is not null
                            then 100 * coalesce((stats->>'off_snp')::numeric, 0)
                                 / (stats->>'tm_off_snp')::numeric end), 1),
      'carries',   round(avg(coalesce((stats->>'rush_att')::numeric, 0)), 1),
      'targets',   round(avg(coalesce((stats->>'rec_tgt')::numeric, 0)), 1),
      'catches',   round(avg(coalesce((stats->>'rec')::numeric, 0)), 1),
      'rush_yds',  round(avg(coalesce((stats->>'rush_yd')::numeric, 0)), 1),
      'rec_yds',   round(avg(coalesce((stats->>'rec_yd')::numeric, 0)), 1),
      'pass_yds',  round(avg(coalesce((stats->>'pass_yd')::numeric, 0)), 1),
      'pass_att',  round(avg(coalesce((stats->>'pass_att')::numeric, 0)), 1),
      'tds',       round(avg(coalesce((stats->>'pass_td')::numeric, 0)
                           + coalesce((stats->>'rush_td')::numeric, 0)
                           + coalesce((stats->>'rec_td')::numeric, 0)), 2),
      'turnovers', round(avg(coalesce((stats->>'pass_int')::numeric, 0)
                           + coalesce((stats->>'fum_lost')::numeric, 0)), 2),
      'fg_made',   round(avg(coalesce((stats->>'fgm')::numeric, 0)), 1),
      'sacks',     round(avg(coalesce((stats->>'sack')::numeric, 0)), 1)
    )),
    -- Season totals, not per-game: what the back of the card says.
    'totals',     jsonb_strip_nulls(jsonb_build_object(
      'rush_att',  nullif(sum(coalesce((stats->>'rush_att')::numeric, 0)), 0),
      'rush_yd',   nullif(sum(coalesce((stats->>'rush_yd')::numeric, 0)), 0),
      'rec_tgt',   nullif(sum(coalesce((stats->>'rec_tgt')::numeric, 0)), 0),
      'rec',       nullif(sum(coalesce((stats->>'rec')::numeric, 0)), 0),
      'rec_yd',    nullif(sum(coalesce((stats->>'rec_yd')::numeric, 0)), 0),
      'pass_att',  nullif(sum(coalesce((stats->>'pass_att')::numeric, 0)), 0),
      'pass_cmp',  nullif(sum(coalesce((stats->>'pass_cmp')::numeric, 0)), 0),
      'pass_yd',   nullif(sum(coalesce((stats->>'pass_yd')::numeric, 0)), 0),
      'pass_td',   nullif(sum(coalesce((stats->>'pass_td')::numeric, 0)), 0),
      'rush_td',   nullif(sum(coalesce((stats->>'rush_td')::numeric, 0)), 0),
      'rec_td',    nullif(sum(coalesce((stats->>'rec_td')::numeric, 0)), 0),
      'pass_int',  nullif(sum(coalesce((stats->>'pass_int')::numeric, 0)), 0),
      'fum_lost',  nullif(sum(coalesce((stats->>'fum_lost')::numeric, 0)), 0),
      'fgm',       nullif(sum(coalesce((stats->>'fgm')::numeric, 0)), 0),
      'fga',       nullif(sum(coalesce((stats->>'fga')::numeric, 0)), 0),
      'sack',      nullif(sum(coalesce((stats->>'sack')::numeric, 0)), 0)
    ))
  ) end
  from log
$$;

-- ----------------------------------------------------------------------------
-- The card itself.
-- ----------------------------------------------------------------------------

create or replace function public.ff_player_card(p_player_id uuid, p_week integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p        players%rowtype;
  v_league   leagues%rowtype;
  v_week     integer;
  v_rules    jsonb;
  v_espn     text;
  v_this     jsonb;
  v_last     jsonb;
  v_last_yr  integer;
  v_proj     jsonb;
  v_rest     numeric;
  v_news     jsonb;
  v_depth    jsonb;
  v_injury   jsonb;
  v_owner    jsonb;
  v_game     jsonb;
  v_market   jsonb;
begin
  if not public.ff_is_member() and auth.uid() is not null then
    raise exception 'not a member of this league';
  end if;

  select * into v_p from players where id = p_player_id;
  if not found then raise exception 'player not found'; end if;

  -- One deployment, one league; the card is priced in its rules.
  select * into v_league from leagues order by created_at limit 1;
  v_week  := coalesce(p_week, public.ff_current_week());
  v_rules := public.ff_rules_for_week(v_league.id, v_week);

  select source_id into v_espn from player_id_map
   where player_id = p_player_id and source in ('espn','espn_team') limit 1;

  -- --------------------------------------------------------------- seasons --
  v_this := public.ff_player_season(p_player_id, v_league.season, v_rules);

  -- The most recent earlier season he actually has lines in, so a rookie or a
  -- returning veteran both get an honest answer rather than a hardcoded year.
  select max(season) into v_last_yr from player_stat_lines
   where player_id = p_player_id and season < v_league.season and season_type = 2;
  if v_last_yr is not null then
    v_last := public.ff_player_season(p_player_id, v_last_yr, v_rules);
  end if;

  -- ----------------------------------------------------------- projections --
  select coalesce(jsonb_agg(jsonb_build_object(
           'week', pj.week,
           'points', round(public.ff_score(pj.stats, public.ff_rules_for_week(v_league.id, pj.week)), 2),
           'source_ppr', pj.ref_points,
           'stats', pj.stats,
           'updated_at', pj.updated_at
         ) order by pj.week), '[]'::jsonb)
    into v_proj
    from player_projections pj
   where pj.player_id = p_player_id and pj.season = v_league.season
     and pj.season_type = 2 and pj.week >= v_week;

  select sum(round(public.ff_score(pj.stats, public.ff_rules_for_week(v_league.id, pj.week)), 2))
    into v_rest
    from player_projections pj
   where pj.player_id = p_player_id and pj.season = v_league.season
     and pj.season_type = 2 and pj.week >= v_week;

  -- --------------------------------------------------------------- injury --
  select to_jsonb(x) into v_injury from (
    select i.status, i.severity, i.detail, i.location, i.comment,
           i.return_date, i.reported_at
      from nfl_injuries i
     where i.player_id = p_player_id
     order by case i.severity when 'out' then 1 when 'doubtful' then 2
                              when 'questionable' then 3 else 4 end
     limit 1
  ) x;

  -- ----------------------------------------------------------------- game --
  select jsonb_build_object(
           'opponent', case when g.home_team = v_p.nfl_team then g.away_team else g.home_team end,
           'home', (g.home_team = v_p.nfl_team),
           'kickoff_at', g.kickoff_at, 'status', g.status, 'status_detail', g.status_detail)
    into v_game
    from nfl_games g
   where g.season = v_league.season and g.season_type = 2 and g.week = v_week
     and v_p.nfl_team in (g.home_team, g.away_team);

  -- ------------------------------------------------------------ depth chart --
  -- His own club's room at his position, in the coaching staff's order, with
  -- what each man has been worth. This is the context an injury headline needs.
  select coalesce(jsonb_agg(d order by (d->>'order')::int nulls last, (d->>'avg_points')::numeric desc nulls last), '[]'::jsonb)
    into v_depth
    from (
      select jsonb_build_object(
               'player_id', q.id,
               'name', q.full_name,
               'order', q.depth_chart_order,
               'injury_status', q.injury_status,
               'is_this_player', (q.id = p_player_id),
               'avg_points', (
                 select round(avg(public.ff_score(sl.stats, v_rules)), 1)
                   from player_stat_lines sl
                  where sl.player_id = q.id and sl.season_type = 2
                    and sl.season = coalesce(v_last_yr, v_league.season)
                    and sl.source = 'sleeper')
             ) as d
        from players q
       where q.nfl_team = v_p.nfl_team and q.position = v_p.position
         and q.status = 'ACT'
       order by q.depth_chart_order nulls last
       limit 8
    ) s;

  -- ----------------------------------------------------------------- news --
  select coalesce(jsonb_agg(n order by n->>'published_at' desc), '[]'::jsonb)
    into v_news
    from (
      select jsonb_build_object(
               'id', x.id, 'headline', x.headline, 'description', x.description,
               'published_at', x.published_at, 'url', x.url,
               'image_url', x.image_url, 'image_alt', x.image_alt,
               'byline', x.byline) as n
        from nfl_news x
       where (v_espn is not null and exists (
               select 1 from jsonb_array_elements(x.athletes) a where a->>'id' = v_espn))
          or (v_p.nfl_team is not null and v_p.nfl_team = any(x.teams))
       order by x.published_at desc nulls last
       limit 8
    ) s;

  -- ---------------------------------------------------------------- owner --
  select jsonb_build_object('team_id', t.id, 'team_name', t.name, 'slot', r.slot)
    into v_owner
    from rosters r join teams t on t.id = r.team_id
   where r.player_id = p_player_id and r.week = v_week and t.league_id = v_league.id
   limit 1;

  -- --------------------------------------------------------------- market --
  select jsonb_build_object('adp', a.adp, 'overall_rank', a.overall_rank)
    into v_market
    from player_adp a
   where a.player_id = p_player_id and a.season = v_league.season
     and a.format = 'ppr' and a.teams = 12
   limit 1;

  return jsonb_build_object(
    'player', jsonb_build_object(
      'id', v_p.id, 'full_name', v_p.full_name,
      'first_name', v_p.first_name, 'last_name', v_p.last_name,
      'position', v_p.position, 'nfl_team', v_p.nfl_team, 'status', v_p.status,
      'bye_week', v_p.bye_week, 'jersey', v_p.jersey, 'age', v_p.age,
      'birth_date', v_p.birth_date, 'height_in', v_p.height_in,
      'weight_lb', v_p.weight_lb, 'college', v_p.college,
      'high_school', v_p.high_school, 'years_exp', v_p.years_exp,
      'rookie_year', v_p.rookie_year, 'depth_chart_order', v_p.depth_chart_order,
      'depth_chart_pos', v_p.depth_chart_pos, 'espn_id', v_espn,
      'sleeper_id', v_p.sleeper_id
    ),
    'league',       jsonb_build_object('season', v_league.season, 'name', v_league.name),
    'week',         v_week,
    'game',         v_game,
    'injury',       v_injury,
    'this_season',  v_this,
    'last_season',  v_last,
    'projections',  v_proj,
    'rest_of_season', round(coalesce(v_rest, 0), 1),
    'depth_chart',  v_depth,
    'news',         v_news,
    'roster_spot',  v_owner,
    'market',       v_market,
    'generated_at', now()
  );
end $$;

revoke all on function public.ff_player_card(uuid, integer) from public;
grant execute on function public.ff_player_card(uuid, integer) to authenticated;

comment on function public.ff_player_card(uuid, integer) is
  'Everything the player page renders: bio, club, injury, this season and last (scored with league rules), projections, depth chart, news and who rosters him.';
