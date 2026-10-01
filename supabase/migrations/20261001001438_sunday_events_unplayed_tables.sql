-- ============================================================================
-- The event engine, second look: a table that has not kicked off.
--
-- 20260930235409_sunday_events was applied, and the first thing done with it
-- was to run the detector twice against production's real week inside a
-- transaction that rolled back. The first look seeded; the second raised:
--
--   null value in column "upset_fired" of relation "sunday_matchup_state"
--
-- A table whose games have not started has no leader yet (NULL) and can
-- still have an underdog on paper. `t.leader = t.dog` is then NULL rather
-- than false, and the every-minute update wrote that NULL into a NOT NULL
-- flag. The test fixture had no unplayed table with an underdog; a real week
-- is full of them, so the first Thursday would have logged detect_failed every
-- minute and posted nothing.
--
-- Nothing ran in production in the meantime: the job only works while games
-- are in the window, and there have been none since it was applied.
--
-- The function is restated from 20260930235409 with that one expression
-- wrapped in coalesce; supabase/tests/sunday_events.sql now carries an
-- unplayed table with an underdog, and failed against the old body.
-- ============================================================================

create or replace function public.ff_sunday_detect(p_league_id uuid, p_week integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league leagues%rowtype;
  v_week   integer;
  v_rules  jsonb;
  w        jsonb;
  v_n      integer := 0;
  v_k      integer;
  v_high   numeric;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then return 0; end if;

  -- One detector per league at a time. The loser of a race does nothing; the
  -- winner's snapshot is the one the next minute diffs against.
  if not pg_try_advisory_xact_lock(hashtext('ff_sunday_detect:' || p_league_id::text)) then
    return 0;
  end if;

  v_week  := greatest(1, coalesce(p_week, public.ff_current_week()));
  v_rules := public.ff_rules_for_week(p_league_id, v_week);
  w       := public.ff_sunday_weights(p_league_id);

  -- --------------------------------------------------------------- now --
  -- Every starter in the week, scored with the rules in force for it: the
  -- same ff_score over the same Sleeper line the board prints.
  drop table if exists _sd_cur;
  create temp table _sd_cur on commit drop as
  select m.id as matchup_id,
         case when r.team_id = m.home_team_id then 'home' else 'away' end as side,
         r.team_id,
         case when r.team_id = m.home_team_id then m.away_team_id else m.home_team_id end as opp_team_id,
         r.player_id, p.full_name, p.position, p.nfl_team,
         coalesce(round(public.ff_score(sl.stats, v_rules), 2), 0)::numeric(8,2) as points,
         coalesce(sl.stats, '{}'::jsonb) as stats,
         coalesce(round(public.ff_score(pj.stats, v_rules), 2), 0) as projection,
         g.id as game_id, g.status as game_status, g.status_detail as game_detail, g.kickoff_at
    from matchups m
    join rosters r
      on r.week = v_week and r.team_id in (m.home_team_id, m.away_team_id) and r.slot <> 'BN'
    join players p on p.id = r.player_id
    left join lateral (
      select x.stats from player_stat_lines x
       where x.player_id = r.player_id and x.season = v_league.season and x.season_type = 2
         and x.week = v_week and x.source = 'sleeper'
       order by x.updated_at desc limit 1) sl on true
    left join lateral (
      select x.stats from player_projections x
       where x.player_id = r.player_id and x.season = v_league.season and x.season_type = 2
         and x.week = v_week and x.source = 'sleeper'
       order by x.updated_at desc limit 1) pj on true
    left join nfl_games g
      on g.season = v_league.season and g.season_type = 2 and g.week = v_week
     and p.nfl_team in (g.home_team, g.away_team)
   where m.league_id = p_league_id and m.week = v_week;

  -- Every table, summed from the rows above so the before/after on an event
  -- is always the sum of the lines it was diffed from.
  drop table if exists _sd_m;
  create temp table _sd_m on commit drop as
  select m.id as matchup_id, m.home_team_id, m.away_team_id,
         coalesce(h.pts, 0) as hp, coalesce(a.pts, 0) as ap,
         coalesce(h.proj, 0) as hproj, coalesce(a.proj, 0) as aproj,
         coalesce(h.n, 0) + coalesce(a.n, 0) as n,
         coalesce(h.left_n, 0) + coalesce(a.left_n, 0) as left_n,
         coalesce(h.q4, false) or coalesce(a.q4, false) as q4,
         coalesce(h.played, false) or coalesce(a.played, false) as played
    from matchups m
    left join lateral (
      select sum(c.points) as pts, sum(c.projection) as proj, count(*) as n,
             count(*) filter (where not coalesce(c.game_status = 'post', c.kickoff_at is null)) as left_n,
             bool_or(c.game_status = 'in' and coalesce(c.game_detail, '') ~* '(4th|Q4|OT)') as q4,
             bool_or(c.game_status in ('in','post') or c.points <> 0) as played
        from _sd_cur c where c.matchup_id = m.id and c.team_id = m.home_team_id) h on true
    left join lateral (
      select sum(c.points) as pts, sum(c.projection) as proj, count(*) as n,
             count(*) filter (where not coalesce(c.game_status = 'post', c.kickoff_at is null)) as left_n,
             bool_or(c.game_status = 'in' and coalesce(c.game_detail, '') ~* '(4th|Q4|OT)') as q4,
             bool_or(c.game_status in ('in','post') or c.points <> 0) as played
        from _sd_cur c where c.matchup_id = m.id and c.team_id = m.away_team_id) a on true
   where m.league_id = p_league_id and m.week = v_week;

  alter table _sd_m
    add column leader text, add column late boolean, add column settled boolean,
    add column dog text;
  update _sd_m set
    leader  = case when not played then null when hp > ap then 'home' when ap > hp then 'away' end,
    late    = played and left_n > 0 and (q4 or left_n <= 3),
    settled = played and n > 0 and left_n = 0,
    dog     = case when hproj - aproj >= (w->>'upset_gap')::numeric then 'away'
                   when aproj - hproj >= (w->>'upset_gap')::numeric then 'home' end;

  -- ------------------------------------------------------ the first look --
  if not exists (select 1 from sunday_player_state
                  where league_id = p_league_id and season = v_league.season and week = v_week) then
    insert into sunday_player_state (league_id, season, week, team_id, player_id, points, stats)
    select p_league_id, v_league.season, v_week, c.team_id, c.player_id, c.points, c.stats from _sd_cur c
    on conflict do nothing;

    insert into sunday_matchup_state (matchup_id, league_id, leader, close_on, upset_fired, final_fired,
                                      home_points, away_points)
    select m.matchup_id, p_league_id, m.leader,
           coalesce(m.late and abs(m.hp - m.ap) <= (w->>'close_margin')::numeric, false),
           coalesce(m.dog is not null and m.leader = m.dog, false),
           coalesce(m.settled, false), m.hp, m.ap
      from _sd_m m
    on conflict (matchup_id) do update
      set leader = excluded.leader, close_on = excluded.close_on, upset_fired = excluded.upset_fired,
          final_fired = excluded.final_fired, home_points = excluded.home_points,
          away_points = excluded.away_points, updated_at = now();

    insert into sunday_game_state (league_id, nfl_game_id, red_zone, possession)
    select p_league_id, g.id, g.status = 'in' and g.red_zone, g.possession
      from nfl_games g
     where g.season = v_league.season and g.season_type = 2 and g.week = v_week
    on conflict (league_id, nfl_game_id) do update
      set red_zone = excluded.red_zone, possession = excluded.possession, updated_at = now();
    return 0;
  end if;

  -- A table that appeared since the first look (a schedule posted late)
  -- starts from where it is, the same way the week did.
  insert into sunday_matchup_state (matchup_id, league_id, leader, final_fired, home_points, away_points)
  select m.matchup_id, p_league_id, m.leader, coalesce(m.settled, false), m.hp, m.ap from _sd_m m
  on conflict (matchup_id) do nothing;

  v_high := (select max(greatest(hp, ap)) from _sd_m);

  -- ------------------------------------------------------ the tables --
  drop table if exists _sd_t;
  create temp table _sd_t on commit drop as
  select m.*, st.leader as old_leader, st.home_points as old_hp, st.away_points as old_ap,
         st.lead_changes, st.close_on, st.close_count, st.upset_fired, st.final_fired,
         (st.leader is not null and m.leader is not null and st.leader <> m.leader) as lead_changed
    from _sd_m m
    join sunday_matchup_state st on st.matchup_id = m.matchup_id;

  -- -------------------------------------------------------- the players --
  drop table if exists _sd_p;
  create temp table _sd_p on commit drop as
  select c.*, s.points as old_points, s.stats as old_stats,
         round(c.points - s.points, 2) as delta,
         public.ff_td_count(c.stats, c.position) as td_total,
         public.ff_td_count(c.stats, c.position) - public.ff_td_count(s.stats, c.position) as td_new,
         case when c.position = 'DST' then 0 else
           (coalesce((c.stats->>'pass_int')::numeric, 0) + coalesce((c.stats->>'fum_lost')::numeric, 0))::integer end as to_total,
         case when c.position = 'DST' then 0 else
           (coalesce((c.stats->>'pass_int')::numeric, 0) + coalesce((c.stats->>'fum_lost')::numeric, 0)
            - coalesce((s.stats->>'pass_int')::numeric, 0) - coalesce((s.stats->>'fum_lost')::numeric, 0))::integer end as to_new,
         (coalesce((c.stats->>'rec_td_40p')::numeric, 0) + coalesce((c.stats->>'rush_td_40p')::numeric, 0)
          + coalesce((c.stats->>'pass_td_40p')::numeric, 0))
         > (coalesce((s.stats->>'rec_td_40p')::numeric, 0) + coalesce((s.stats->>'rush_td_40p')::numeric, 0)
          + coalesce((s.stats->>'pass_td_40p')::numeric, 0)) as long_td,
         case
           when c.position = 'DST' then 'defensive touchdown'
           when coalesce((c.stats->>'rush_td')::numeric, 0) > coalesce((s.stats->>'rush_td')::numeric, 0) then 'rushing touchdown'
           when coalesce((c.stats->>'rec_td')::numeric, 0) > coalesce((s.stats->>'rec_td')::numeric, 0) then 'receiving touchdown'
           when coalesce((c.stats->>'pass_td')::numeric, 0) > coalesce((s.stats->>'pass_td')::numeric, 0) then 'touchdown pass'
           else 'touchdown'
         end as td_label,
         case
           when coalesce((c.stats->>'pass_int_td')::numeric, 0) > coalesce((s.stats->>'pass_int_td')::numeric, 0) then 'pick-six thrown'
           when coalesce((c.stats->>'pass_int')::numeric, 0) > coalesce((s.stats->>'pass_int')::numeric, 0) then 'interception thrown'
           else 'fumble lost'
         end as to_label
    from _sd_cur c
    join sunday_player_state s
      on s.league_id = p_league_id and s.season = v_league.season and s.week = v_week
     and s.team_id = c.team_id and s.player_id = c.player_id
   where c.points <> s.points or c.stats <> s.stats;

  alter table _sd_p add column kind text, add column key text,
                    add column takes_lead boolean not null default false;
  update _sd_p set kind = case
      when td_new > 0 then 'touchdown'
      when to_new > 0 then 'turnover'
      when delta >= (w->>'big_play_points')::numeric then 'big_play'
      when delta >= (w->>'scoring_points')::numeric then 'scoring'
    end;
  update _sd_p set key = case kind
      when 'touchdown' then format('td:%s:%s:%s:%s', v_week, team_id, player_id, td_total)
      when 'turnover'  then format('to:%s:%s:%s:%s', v_week, team_id, player_id, to_total)
      when 'big_play'  then format('big:%s:%s:%s:%s', v_week, team_id, player_id, points)
      when 'scoring'   then format('pts:%s:%s:%s:%s', v_week, team_id, player_id, points)
    end;

  -- A lead change is told once. When the side that just took the lead scored
  -- a touchdown in the same look, the touchdown IS the lead change — "Allen,
  -- +6.2 Ray, Ray takes the lead" — and it carries the flag rather than a
  -- second card saying the same thing. The biggest scoring play on that side
  -- gets it.
  update _sd_p p set takes_lead = true
    from (
      select distinct on (p2.matchup_id) p2.matchup_id, p2.player_id
        from _sd_p p2
        join _sd_t t on t.matchup_id = p2.matchup_id and t.lead_changed and t.leader = p2.side
       where p2.kind in ('touchdown', 'big_play') and p2.delta > 0
         -- Only a play that is itself new can carry the lead. A touchdown taken
         -- away by a correction and restored is already told; the lead change
         -- it brings back is not, and must get its own card below.
         and not exists (select 1 from sunday_events e
                          where e.league_id = p_league_id and e.season = v_league.season
                            and e.dedupe_key = p2.key)
       order by p2.matchup_id, (p2.kind = 'touchdown') desc, p2.delta desc
    ) pick
   where p.matchup_id = pick.matchup_id and p.player_id = pick.player_id;

  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, player_id, nfl_game_id,
                             points_added, old_score, new_score, opp_old_score, opp_new_score,
                             lead_change, headline, description, detail)
  select p_league_id, v_league.season, v_week,
         p.key,
         p.kind,
         case
           when p.takes_lead and t.late then 4
           when p.takes_lead then 3
           when p.kind = 'scoring' then 1
           else 2
         end,
         (case p.kind when 'touchdown' then (w->>'touchdown')::int when 'big_play' then 10
                      when 'turnover' then 10 else 0 end)
         + case when p.takes_lead then (w->>'lead_change')::int else 0 end
         + case when abs(t.hp - t.ap) <= 1 then (w->>'within1')::int
                when abs(t.hp - t.ap) <= 5 then (w->>'within5')::int else 0 end
         + case when t.late then (w->>'fourth_quarter')::int else 0 end
         + case when p.kind <> 'turnover' and v_high > 0
                 and (case when p.side = 'home' then t.hp else t.ap end) = v_high
                then (w->>'league_high')::int else 0 end,
         p.matchup_id, p.team_id, p.opp_team_id, p.player_id, p.game_id,
         p.delta,
         case when p.side = 'home' then t.old_hp else t.old_ap end,
         case when p.side = 'home' then t.hp else t.ap end,
         case when p.side = 'home' then t.old_ap else t.old_hp end,
         case when p.side = 'home' then t.ap else t.hp end,
         p.takes_lead,
         case p.kind
           when 'touchdown' then p.full_name || ' — '
                || case when p.td_new > 1 then p.td_new || ' touchdowns'
                        when p.long_td then '40+ yard ' || p.td_label
                        else p.td_label end
           when 'turnover'  then p.full_name || ' — ' || p.to_label
           when 'big_play'  then p.full_name || ' — big gain'
           else p.full_name
         end,
         case
           when p.takes_lead then public.ff_team_label(p.team_id) || ' takes the lead over '
                                  || public.ff_team_label(p.opp_team_id)
           when p.kind = 'big_play' then '+' || p.delta || ' since the last update'
         end,
         jsonb_build_object(
           'who', public.ff_team_label(p.team_id), 'opp', public.ff_team_label(p.opp_team_id),
           'side', p.side, 'position', p.position, 'nfl_team', p.nfl_team,
           'game_detail', p.game_detail, 'late', coalesce(t.late, false),
           'margin', round(abs(t.hp - t.ap), 2))
    from _sd_p p
    join _sd_t t on t.matchup_id = p.matchup_id
   where p.kind is not null
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- -------------------------------------------------- lead changes --
  -- The ones no scoring play above already told.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, old_score, new_score,
                             opp_old_score, opp_new_score, lead_change, headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('lead:%s:%s', t.matchup_id, t.lead_changes + 1),
         'lead_change',
         case when t.late then 4 else 3 end,
         (w->>'lead_change')::int
         + case when abs(t.hp - t.ap) <= 1 then (w->>'within1')::int
                when abs(t.hp - t.ap) <= 5 then (w->>'within5')::int else 0 end
         + case when t.late then (w->>'fourth_quarter')::int else 0 end,
         t.matchup_id,
         case when t.leader = 'home' then t.home_team_id else t.away_team_id end,
         case when t.leader = 'home' then t.away_team_id else t.home_team_id end,
         case when t.leader = 'home' then t.old_hp else t.old_ap end,
         case when t.leader = 'home' then t.hp else t.ap end,
         case when t.leader = 'home' then t.old_ap else t.old_hp end,
         case when t.leader = 'home' then t.ap else t.hp end,
         true,
         public.ff_team_label(case when t.leader = 'home' then t.home_team_id else t.away_team_id end)
           || ' takes the lead over '
           || public.ff_team_label(case when t.leader = 'home' then t.away_team_id else t.home_team_id end),
         case when t.late then 'Late, with ' || t.left_n || ' still to play' end,
         jsonb_build_object('late', coalesce(t.late, false), 'margin', round(abs(t.hp - t.ap), 2),
                            'who', public.ff_team_label(case when t.leader = 'home' then t.home_team_id else t.away_team_id end),
                            'opp', public.ff_team_label(case when t.leader = 'home' then t.away_team_id else t.home_team_id end))
    from _sd_t t
   where t.lead_changed
     and not exists (select 1 from _sd_p p where p.matchup_id = t.matchup_id and p.takes_lead)
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- ------------------------------------------------------ close games --
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, old_score, new_score, headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('close:%s:%s', t.matchup_id, t.close_count + 1),
         'close_game',
         case when abs(t.hp - t.ap) < 1 then 4 else 3 end,
         case when abs(t.hp - t.ap) <= 1 then (w->>'within1')::int else (w->>'within5')::int end
         + (w->>'fourth_quarter')::int,
         t.matchup_id, t.hp, t.ap,
         public.ff_team_label(t.home_team_id) || ' ' || t.hp || ' — '
           || public.ff_team_label(t.away_team_id) || ' ' || t.ap,
         'Difference ' || round(abs(t.hp - t.ap), 2) || ', ' || t.left_n || ' still to play',
         jsonb_build_object('home', public.ff_team_label(t.home_team_id), 'away', public.ff_team_label(t.away_team_id),
                            'margin', round(abs(t.hp - t.ap), 2), 'left', t.left_n)
    from _sd_t t
   where t.late and not t.settled and not t.close_on
     and abs(t.hp - t.ap) <= (w->>'close_margin')::numeric
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- ----------------------------------------------------------- upsets --
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, new_score, opp_new_score,
                             headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('upset:%s', t.matchup_id), 'upset_watch', 3, (w->>'upset')::int,
         t.matchup_id,
         case when t.dog = 'home' then t.home_team_id else t.away_team_id end,
         case when t.dog = 'home' then t.away_team_id else t.home_team_id end,
         case when t.dog = 'home' then t.hp else t.ap end,
         case when t.dog = 'home' then t.ap else t.hp end,
         public.ff_team_label(case when t.dog = 'home' then t.home_team_id else t.away_team_id end)
           || ' leads ' || public.ff_team_label(case when t.dog = 'home' then t.away_team_id else t.home_team_id end),
         'Came in projected ' || round(abs(t.hproj - t.aproj), 1) || ' behind',
         jsonb_build_object('gap', round(abs(t.hproj - t.aproj), 1))
    from _sd_t t
   where not t.upset_fired and not t.settled and t.dog is not null and t.leader = t.dog
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- ------------------------------------------------------------ finals --
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, new_score, opp_new_score,
                             headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('final:%s', t.matchup_id), 'final',
         case when abs(t.hp - t.ap) < 1 then 4 when t.dog is not null and t.leader = t.dog then 3 else 1 end,
         case when abs(t.hp - t.ap) < 1 then (w->>'within1')::int
              when t.dog is not null and t.leader = t.dog then (w->>'upset')::int else 0 end,
         t.matchup_id,
         case when t.leader = 'away' then t.away_team_id else t.home_team_id end,
         case when t.leader = 'away' then t.home_team_id else t.away_team_id end,
         greatest(t.hp, t.ap), least(t.hp, t.ap),
         case when t.leader is null then 'Dead heat: '
              else public.ff_team_label(case when t.leader = 'away' then t.away_team_id else t.home_team_id end)
                   || ' beats ' || public.ff_team_label(case when t.leader = 'away' then t.home_team_id else t.away_team_id end) || ', '
         end || greatest(t.hp, t.ap) || '–' || least(t.hp, t.ap),
         case when abs(t.hp - t.ap) < 1 then 'Decided by less than a point'
              when t.dog is not null and t.leader = t.dog then 'The upset: came in projected ' || round(abs(t.hproj - t.aproj), 1) || ' behind' end,
         jsonb_build_object('margin', round(abs(t.hp - t.ap), 2),
                            'upset', coalesce(t.dog is not null and t.leader = t.dog, false))
    from _sd_t t
   where t.settled and not t.final_fired
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- ---------------------------------------------------------- red zone --
  -- A drive that has just crossed the twenty, in a game where one of ours
  -- plays for the side with the ball. Kickers and defenses are not named.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             nfl_game_id, matchup_id, team_id, headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('rz:%s:%s:%s', p_league_id, g.id, coalesce(gs.drives, 0) + 1),
         'red_zone', 2, (w->>'touchdown')::int / 2,
         g.id, ours.matchup_id, ours.team_id,
         'In the red zone: ' || ours.names,
         g.possession || ' ball' || coalesce(' — ' || g.down_distance, ''),
         jsonb_build_object('players', ours.players, 'possession', g.possession,
                            'down_distance', g.down_distance)
    from nfl_games g
    left join sunday_game_state gs on gs.league_id = p_league_id and gs.nfl_game_id = g.id
    join lateral (
      select string_agg(c.full_name, ', ' order by c.projection desc) as names,
             jsonb_agg(jsonb_build_object('name', c.full_name, 'who', public.ff_team_label(c.team_id),
                                          'team_id', c.team_id, 'matchup_id', c.matchup_id)
                       order by c.projection desc) as players,
             (array_agg(c.matchup_id order by c.projection desc))[1] as matchup_id,
             (array_agg(c.team_id order by c.projection desc))[1] as team_id
        from _sd_cur c
       where c.nfl_team = g.possession and c.position not in ('K', 'DST')
      having count(*) > 0
    ) ours on true
   where g.season = v_league.season and g.season_type = 2 and g.week = v_week
     and g.status = 'in' and g.red_zone and g.possession is not null
     and not coalesce(gs.red_zone, false)
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- ------------------------------------------------------ move forward --
  insert into sunday_game_state (league_id, nfl_game_id, red_zone, possession, drives)
  select p_league_id, g.id, g.status = 'in' and g.red_zone, g.possession,
         case when g.status = 'in' and g.red_zone and not coalesce(gs.red_zone, false)
              then coalesce(gs.drives, 0) + 1 else coalesce(gs.drives, 0) end
    from nfl_games g
    left join sunday_game_state gs on gs.league_id = p_league_id and gs.nfl_game_id = g.id
   where g.season = v_league.season and g.season_type = 2 and g.week = v_week
  on conflict (league_id, nfl_game_id) do update
    set red_zone = excluded.red_zone, possession = excluded.possession,
        drives = excluded.drives, updated_at = now();

  update sunday_matchup_state st set
    -- A tie keeps the last leader, so going level and back is not a change.
    leader       = coalesce(t.leader, t.old_leader),
    lead_changes = t.lead_changes + case when t.lead_changed then 1 else 0 end,
    close_on     = case when t.late and not t.settled and abs(t.hp - t.ap) <= (w->>'close_margin')::numeric then true
                        when abs(t.hp - t.ap) > (w->>'close_reset')::numeric then false
                        else t.close_on end,
    close_count  = t.close_count + case when t.late and not t.settled and not t.close_on
                                         and abs(t.hp - t.ap) <= (w->>'close_margin')::numeric then 1 else 0 end,
    -- coalesce: a table nobody has kicked in has no leader, and NULL = 'home'
    -- is NULL, not false. Only the update needed it; the first look and the
    -- inserts above already read a NULL comparison as "no".
    upset_fired  = t.upset_fired or coalesce(not t.settled and t.dog is not null and t.leader = t.dog, false),
    final_fired  = t.final_fired or coalesce(t.settled, false),
    home_points  = t.hp,
    away_points  = t.ap,
    updated_at   = now()
    from _sd_t t
   where st.matchup_id = t.matchup_id;

  insert into sunday_player_state (league_id, season, week, team_id, player_id, points, stats)
  select p_league_id, v_league.season, v_week, c.team_id, c.player_id, c.points, c.stats from _sd_cur c
  on conflict (league_id, season, week, team_id, player_id) do update
    set points = excluded.points, stats = excluded.stats, updated_at = now()
    where sunday_player_state.points is distinct from excluded.points
       or sunday_player_state.stats is distinct from excluded.stats;

  return v_n;
end;
$fn$;

revoke all on function public.ff_sunday_detect(uuid, integer) from public, anon, authenticated;

comment on function public.ff_sunday_detect(uuid, integer) is
  'Service only. Diffs one league''s week against the last look and writes what changed to sunday_events. Idempotent; the first look of a week seeds the snapshot and writes nothing.';
