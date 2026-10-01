-- ============================================================================
-- Steakhouse Sunday, phase 4: the game center knows the league.
--
-- Phases 1-3 made the page say what the football did and let the room answer.
-- This gives it the league's memory, so it can say why a table matters — and
-- only what the league's own data supports. Nothing here writes a sentence the
-- browser could not check against a number beside it.
--
-- FACTS, NOT PROSE. `ff_sunday` gains `intel`: the table going into the week
-- (record, rank, current streak), the season's high score, every pairing's
-- head-to-head from ff_all_games (the same history the rivalry card and the
-- history wall read, so the three cannot disagree), the scoring rules in force
-- this week, and the playoff line. The browser writes the storylines from
-- these, live — "Trav is chasing his fourth straight win" has to stop being
-- true the moment he is losing at 4pm, and only the page knows the 4pm score.
--
-- ONE SET OF WEIGHTS. The excitement score was written twice: as
-- `ff_sunday_weights` for the detector and as EXCITEMENT in src/lib/sunday.ts
-- for the featured pick, with a comment promising they matched. Now the server
-- table is the only one: it gains the three weights only the browser used,
-- `ff_sunday` hands the merged table to the page, and the commissioner can
-- tune it with `ff_set_sunday_weights` — every key named, every value bounded,
-- an override removed by setting it to null.
--
-- STEAKHOUSE MOMENTS. Three of the spec's level-4 moments the detector could
-- not see from one look at a matchup, written by `ff_sunday_moments` after
-- every detector pass:
--
--   comeback      a side that was down by `comeback_points` or more takes the
--                 lead. The worst deficit each side has faced is kept on the
--                 matchup's state, a minute at a time.
--   season_high   a score passes the season's best — every earlier final week
--                 and everybody else this week. Once per team per week.
--   last v first  the final of a game last place won against first place is
--                 raised to a moment, and says so.
--
-- Same rules as the detector: dedupe keys, `on conflict do nothing`, and
-- nothing for a matchup the detector has not seeded yet.
-- ============================================================================

-- ---------------------------------------------------------------- weights --

-- The defaults, and the bounds each one may be tuned within. One row per key
-- so the setter, the reader and the page all work from the same list.
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
    ('comeback_points',  20, 5, 80,  'threshold')
$$;

create or replace function public.ff_sunday_weight_defaults()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_object_agg(key, dflt) from public.ff_sunday_weight_bounds()
$$;

create or replace function public.ff_sunday_weights(p_league_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.ff_sunday_weight_defaults()
         || coalesce((select l.settings->'sunday_weights' from leagues l where l.id = p_league_id), '{}'::jsonb)
$$;

revoke all on function public.ff_sunday_weights(uuid) from public, anon;
grant execute on function public.ff_sunday_weights(uuid) to authenticated;
revoke all on function public.ff_sunday_weight_bounds() from public, anon;
grant execute on function public.ff_sunday_weight_bounds() to authenticated;
revoke all on function public.ff_sunday_weight_defaults() from public, anon;
grant execute on function public.ff_sunday_weight_defaults() to authenticated;

comment on function public.ff_sunday_weights(uuid) is
  'The Steakhouse Sunday weights and thresholds — ff_sunday_weight_bounds() defaults with the league''s settings.sunday_weights on top. The detector, the moments pass and the page all read this one table.';

-- The commissioner tunes the page. Every key must be one of the known ones and
-- inside its bounds; a null removes the league's override and restores the
-- default. Returns the merged table, as ff_sunday_weights would.
create or replace function public.ff_set_sunday_weights(p_league_id uuid, p_weights jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_cur  jsonb;
  v_key  text;
  v_val  jsonb;
  v_b    record;
  v_n    numeric;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'only the commissioner tunes the game center';
  end if;
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then
    raise exception 'weights must be an object of name: number';
  end if;

  v_cur := coalesce((select settings->'sunday_weights' from leagues where id = p_league_id), '{}'::jsonb);

  for v_key, v_val in select * from jsonb_each(p_weights) loop
    select * into v_b from public.ff_sunday_weight_bounds() b where b.key = v_key;
    if not found then raise exception 'no such weight: %', v_key; end if;

    if jsonb_typeof(v_val) = 'null' then
      v_cur := v_cur - v_key;
      continue;
    end if;
    if jsonb_typeof(v_val) <> 'number' then raise exception '% must be a number', v_key; end if;
    v_n := (v_val #>> '{}')::numeric;
    if v_n <> trunc(v_n) or v_n < v_b.lo or v_n > v_b.hi then
      raise exception '% must be a whole number from % to %', v_key, v_b.lo, v_b.hi;
    end if;
    -- The default is not an override; storing it would only hide a later change of default.
    if v_n = v_b.dflt then v_cur := v_cur - v_key;
    else v_cur := v_cur || jsonb_build_object(v_key, v_n::int);
    end if;
  end loop;

  update leagues
     set settings = case when v_cur = '{}'::jsonb then settings - 'sunday_weights'
                         else jsonb_set(settings, '{sunday_weights}', v_cur) end
   where id = p_league_id;

  return public.ff_sunday_weights(p_league_id);
end $$;

revoke all on function public.ff_set_sunday_weights(uuid, jsonb) from public, anon;
grant execute on function public.ff_set_sunday_weights(uuid, jsonb) to authenticated;

comment on function public.ff_set_sunday_weights(uuid, jsonb) is
  'Commissioner only. Overrides Steakhouse Sunday weights for the league; a null restores a default. Rejects unknown keys and out-of-range values.';

-- ------------------------------------------------------------ the table --

-- The standings going into a week: every result from a final week before it,
-- this season. Rank by wins, then ties, then points for — the order the
-- standings page uses. `streak` is signed: +3 won the last three, -2 lost two.
create or replace function public.ff_sunday_table(p_league_id uuid, p_season integer, p_week integer)
returns table (team_id uuid, wins integer, losses integer, ties integer, pf numeric, rank integer, streak integer)
language sql
stable
security definer
set search_path = public
as $$
  with res as (
    select x.team_id, x.week,
           case when x.mine > x.theirs then 'W' when x.mine < x.theirs then 'L' else 'T' end as r,
           x.mine
      from (
        select m.home_team_id as team_id, m.week, m.home_points as mine, m.away_points as theirs
          from matchups m where m.league_id = p_league_id
        union all
        select m.away_team_id, m.week, m.away_points, m.home_points
          from matchups m where m.league_id = p_league_id
      ) x
     where x.week < p_week
       and public.ff_week_final(p_season, x.week)
       and coalesce(x.mine, 0) + coalesce(x.theirs, 0) > 0
  ),
  ordered as (
    select res.*, row_number() over (partition by res.team_id order by res.week desc) as rn,
           first_value(res.r) over (partition by res.team_id order by res.week desc) as last_r
      from res
  ),
  streaks as (
    select o.team_id, o.last_r,
           coalesce(min(o.rn) filter (where o.r <> o.last_r), max(o.rn) + 1) - 1 as len
      from ordered o group by o.team_id, o.last_r
  ),
  rec as (
    select t.id as team_id,
           count(*) filter (where res.r = 'W')::int as wins,
           count(*) filter (where res.r = 'L')::int as losses,
           count(*) filter (where res.r = 'T')::int as ties,
           coalesce(sum(res.mine), 0) as pf
      from teams t left join res on res.team_id = t.id
     where t.league_id = p_league_id
     group by t.id
  )
  select rec.team_id, rec.wins, rec.losses, rec.ties, rec.pf,
         (rank() over (order by rec.wins desc, rec.ties desc, rec.pf desc))::int,
         coalesce(case s.last_r when 'W' then s.len when 'L' then -s.len else 0 end, 0)::int
    from rec left join streaks s on s.team_id = rec.team_id
$$;

revoke all on function public.ff_sunday_table(uuid, integer, integer) from public, anon, authenticated;

-- The season's high score before this week: the best line from any final week.
create or replace function public.ff_sunday_season_high(p_league_id uuid, p_season integer, p_week integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('points', x.pts, 'team_id', x.team_id, 'week', x.week)
    from (
      select m.home_points as pts, m.home_team_id as team_id, m.week from matchups m
       where m.league_id = p_league_id and m.week < p_week and public.ff_week_final(p_season, m.week)
      union all
      select m.away_points, m.away_team_id, m.week from matchups m
       where m.league_id = p_league_id and m.week < p_week and public.ff_week_final(p_season, m.week)
    ) x
   where x.pts > 0
   order by x.pts desc, x.week
   limit 1
$$;

revoke all on function public.ff_sunday_season_high(uuid, integer, integer) from public, anon, authenticated;

-- Two managers' history, from the home side's chair: meetings, the series, and
-- who has won the last few in a row. Manager names, as ff_rivalry keys it,
-- because a rivalry is between people and clubs get renamed.
create or replace function public.ff_sunday_h2h(p_league_id uuid, p_home text, p_away text,
                                                p_season integer, p_week integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select a.season, a.week,
           case when a.home_manager = p_home then a.home_points else a.away_points end as mine,
           case when a.home_manager = p_home then a.away_points else a.home_points end as theirs
      from public.ff_all_games(p_league_id) a
     where a.played
       and ((a.home_manager = p_home and a.away_manager = p_away)
         or (a.home_manager = p_away and a.away_manager = p_home))
       -- Not this week's game, even once it is played: the story is the past.
       and (a.season, a.week) < (p_season, p_week)
  ),
  r as (
    select g.*, case when mine > theirs then 'H' when mine < theirs then 'A' else 'T' end as w,
           row_number() over (order by season desc, week desc) as rn
      from g
  ),
  lst as (select w from r where rn = 1)
  select case when count(*) = 0 then null else jsonb_build_object(
           'meetings',  count(*),
           'home_wins', count(*) filter (where r.w = 'H'),
           'away_wins', count(*) filter (where r.w = 'A'),
           'ties',      count(*) filter (where r.w = 'T'),
           -- Signed from the home chair: +3 home won the last three meetings.
           'streak',    (select case l.w when 'H' then 1 when 'A' then -1 else 0 end
                                * (coalesce(min(r2.rn) filter (where r2.w <> l.w), max(r2.rn) + 1) - 1)
                           from r r2, lst l group by l.w),
           'since',     min(r.season)
         ) end
    from r
$$;

revoke all on function public.ff_sunday_h2h(uuid, text, text, integer, integer) from public, anon, authenticated;

-- ------------------------------------------------------------- moments --

alter table public.sunday_events drop constraint if exists sunday_events_event_type_check;
alter table public.sunday_events add constraint sunday_events_event_type_check
  check (event_type in ('touchdown','big_play','scoring','turnover','lead_change',
                        'close_game','upset_watch','red_zone','final',
                        'comeback','season_high'));

-- The worst each side has been down this week, a look at a time.
alter table public.sunday_matchup_state
  add column if not exists home_worst numeric(8,2) not null default 0,
  add column if not exists away_worst numeric(8,2) not null default 0;

create or replace function public.ff_sunday_moments(p_league_id uuid, p_week integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league leagues%rowtype;
  v_week   integer;
  w        jsonb;
  v_high   numeric;
  v_n      integer := 0;
  v_k      integer;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then return 0; end if;
  v_week := greatest(1, coalesce(p_week, public.ff_current_week()));
  w      := public.ff_sunday_weights(p_league_id);

  -- Deficits first, so the look that flips a lead has already recorded how far
  -- back the new leader came from.
  update sunday_matchup_state s
     set home_worst = greatest(s.home_worst, s.away_points - s.home_points),
         away_worst = greatest(s.away_worst, s.home_points - s.away_points)
    from matchups m
   where m.id = s.matchup_id and m.league_id = p_league_id and m.week = v_week;

  -- The comeback: the side in front now was down by the threshold or more.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, new_score, opp_new_score,
                             lead_change, headline, description, detail)
  select p_league_id, v_league.season, v_week,
         format('comeback:%s:%s', s.matchup_id, s.leader), 'comeback', 4,
         (w->>'comeback')::int + (w->>'lead_change')::int,
         s.matchup_id,
         case when s.leader = 'home' then m.home_team_id else m.away_team_id end,
         case when s.leader = 'home' then m.away_team_id else m.home_team_id end,
         case when s.leader = 'home' then s.home_points else s.away_points end,
         case when s.leader = 'home' then s.away_points else s.home_points end,
         true,
         public.ff_team_label(case when s.leader = 'home' then m.home_team_id else m.away_team_id end)
           || ' comes back on ' || public.ff_team_label(case when s.leader = 'home' then m.away_team_id else m.home_team_id end),
         'Was down ' || to_char(case when s.leader = 'home' then s.home_worst else s.away_worst end, 'FM99990.0')
           || ' and now leads',
         jsonb_build_object('who', public.ff_team_label(case when s.leader = 'home' then m.home_team_id else m.away_team_id end),
                            'opp', public.ff_team_label(case when s.leader = 'home' then m.away_team_id else m.home_team_id end),
                            'down', case when s.leader = 'home' then s.home_worst else s.away_worst end)
    from sunday_matchup_state s
    join matchups m on m.id = s.matchup_id
   where m.league_id = p_league_id and m.week = v_week
     and s.leader is not null
     and (case when s.leader = 'home' then s.home_worst else s.away_worst end) >= (w->>'comeback_points')::numeric
  on conflict (league_id, season, dedupe_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- The season high: past every earlier final week and everybody else today.
  v_high := coalesce((public.ff_sunday_season_high(p_league_id, v_league.season, v_week)->>'points')::numeric, 0);
  if v_high > 0 then
    insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                               matchup_id, team_id, new_score, headline, description, detail)
    select p_league_id, v_league.season, v_week,
           format('high:%s:%s', v_week, x.team_id), 'season_high', 4,
           (w->>'season_high')::int + (w->>'league_high')::int,
           x.matchup_id, x.team_id, x.pts,
           public.ff_team_label(x.team_id) || ' sets the season high',
           to_char(x.pts, 'FM99990.0') || ', past ' || to_char(v_high, 'FM99990.0'),
           jsonb_build_object('who', public.ff_team_label(x.team_id), 'old_high', v_high)
      from (
        select s.matchup_id, m.home_team_id as team_id, s.home_points as pts
          from sunday_matchup_state s join matchups m on m.id = s.matchup_id
         where m.league_id = p_league_id and m.week = v_week
        union all
        select s.matchup_id, m.away_team_id, s.away_points
          from sunday_matchup_state s join matchups m on m.id = s.matchup_id
         where m.league_id = p_league_id and m.week = v_week
      ) x
     where x.pts > v_high
       -- The best today, too: a record is only set by the one holding it.
       and x.pts >= all (
         select y.pts from (
           select s.home_points as pts, m.home_team_id as team_id
             from sunday_matchup_state s join matchups m on m.id = s.matchup_id
            where m.league_id = p_league_id and m.week = v_week
           union all
           select s.away_points, m.away_team_id
             from sunday_matchup_state s join matchups m on m.id = s.matchup_id
            where m.league_id = p_league_id and m.week = v_week
         ) y where y.team_id <> x.team_id)
    on conflict (league_id, season, dedupe_key) do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;

  -- Last place beats first: the final is already written; raise it.
  update sunday_events e
     set level = 4,
         priority = e.priority + (w->>'upset')::int,
         description = 'Last place beats first place'
    from public.ff_sunday_table(p_league_id, v_league.season, v_week) wt,
         public.ff_sunday_table(p_league_id, v_league.season, v_week) lt
   where e.league_id = p_league_id and e.season = v_league.season and e.week = v_week
     and e.event_type = 'final' and e.level < 4
     and wt.team_id = e.team_id and lt.team_id = e.opponent_team_id
     and wt.rank = (select max(t.rank) from public.ff_sunday_table(p_league_id, v_league.season, v_week) t)
     and lt.rank = 1 and wt.rank > 1
     and wt.wins + wt.losses + wt.ties > 0;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  return v_n;
end;
$fn$;

revoke all on function public.ff_sunday_moments(uuid, integer) from public, anon, authenticated;

comment on function public.ff_sunday_moments(uuid, integer) is
  'Service only. After the detector''s pass: comebacks, season highs, and last place beating first, as Steakhouse moments. Idempotent.';

-- Every league, moments straight after the detector.
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

-- Talk shit on a moment carries the moment.
create or replace function public.ff_sunday_context(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case e.event_type
           when 'lead_change' then
             '🔥 ' || replace(e.headline, ' takes the lead over ', ' just took the lead over ')
             || coalesce(', ' || to_char(e.new_score, 'FM99990.0') || '–' || to_char(e.opp_new_score, 'FM99990.0'), '') || '.'
           when 'touchdown' then
             '🏈 ' || e.headline
             || coalesce(', ' || case when e.points_added >= 0 then '+' else '−' end
                         || to_char(abs(e.points_added), 'FM99990.0') || ' ' || (e.detail->>'who'), '')
             || case when e.lead_change then ' — ' || replace(coalesce(e.description, ''), ' takes the lead over ', ' just took the lead over ') else '' end
             || '.'
           when 'big_play' then
             '💥 ' || e.headline
             || coalesce(', ' || '+' || to_char(e.points_added, 'FM99990.0') || ' ' || (e.detail->>'who'), '') || '.'
           when 'turnover' then
             '😬 ' || e.headline
             || coalesce(', ' || '−' || to_char(abs(e.points_added), 'FM99990.0') || ' ' || (e.detail->>'who'), '') || '.'
           when 'close_game'  then '😬 Close game: ' || e.headline || '.'
           when 'upset_watch' then '👀 Upset watch: ' || e.headline || coalesce(' — ' || e.description, '') || '.'
           when 'red_zone'    then '🔴 ' || e.headline || '.'
           when 'final'       then '🏁 Final: ' || e.headline || coalesce(' — ' || e.description, '') || '.'
           when 'comeback'    then '🚨 ' || e.headline || coalesce(' — ' || lower(e.description), '') || '.'
           when 'season_high' then '🏆 ' || e.headline || coalesce(': ' || e.description, '') || '.'
           else e.headline
         end
    from sunday_events e where e.id = p_event_id
$$;

revoke all on function public.ff_sunday_context(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ the center --
-- ff_sunday, restated from 20261001020059_sunday_social with `intel`.

create or replace function public.ff_sunday(p_league_id uuid, p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_board    jsonb;
  v_season   integer;
  v_week     integer;
  v_nfl      jsonb;
  v_events   jsonb;
  v_activity jsonb;
  v_intel    jsonb;
  v_settings jsonb;
begin
  -- The guard: sign-in, league, membership. It raises before anything below
  -- is read, so this function can never show more than the board would.
  v_board := public.ff_scoreboard(p_league_id, p_week);

  v_season := (v_board->'league'->>'season')::integer;
  v_week   := (v_board->>'week')::integer;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id,
           'home', g.home_team,
           'away', g.away_team,
           'home_score', g.home_score,
           'away_score', g.away_score,
           'kickoff_at', g.kickoff_at,
           'status', g.status,
           'detail', g.status_detail,
           'home_spread', g.home_spread,
           'possession', g.possession,
           'red_zone', g.red_zone,
           'down_distance', g.down_distance,
           'updated_at', g.updated_at
         ) order by g.kickoff_at nulls last, g.home_team), '[]'::jsonb)
    into v_nfl
    from nfl_games g
   where g.season = v_season and g.season_type = 2 and g.week = v_week;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'type', e.event_type,
           'level', e.level,
           'priority', e.priority,
           'matchup_id', e.matchup_id,
           'team_id', e.team_id,
           'opponent_team_id', e.opponent_team_id,
           'player_id', e.player_id,
           'player_name', p.full_name,
           'espn_id', (select max(x.source_id) from player_id_map x
                        where x.player_id = e.player_id and x.source in ('espn','espn_team')),
           'nfl_game_id', e.nfl_game_id,
           'points_added', e.points_added,
           'old_score', e.old_score,
           'new_score', e.new_score,
           'opp_old_score', e.opp_old_score,
           'opp_new_score', e.opp_new_score,
           'lead_change', e.lead_change,
           'headline', e.headline,
           'description', e.description,
           'detail', e.detail,
           'created_at', e.created_at,
           'reactions', coalesce((
             select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine)
                              order by r.n desc, r.emoji)
               from (select emoji, count(*) as n, bool_or(user_id = v_uid) as mine
                       from reactions where source = 'sunday' and target_id = e.id
                      group by emoji) r), '[]'::jsonb),
           'talk', (select count(*) from league_messages m where m.sunday_event_id = e.id)
         ) order by e.created_at desc, e.priority desc), '[]'::jsonb)
    into v_events
    from (select * from sunday_events x
           where x.league_id = p_league_id and x.season = v_season and x.week = v_week
           order by x.created_at desc, x.priority desc
           limit 150) e
    left join players p on p.id = e.player_id;

  select coalesce(jsonb_agg(a.x order by a.at desc), '[]'::jsonb)
    into v_activity
    from (
      (select ce.created_at as at, jsonb_build_object(
                'id', 'ch:' || ce.id,
                'kind', 'challenge',
                'at', ce.created_at,
                'verb', case ce.to_status when 'proposed' then 'proposed'
                                          when 'accepted' then 'accepted'
                                          when 'declined' then 'declined'
                                          else 'settled' end,
                'who', public.ff_team_label(public.ff_seat_team(p_league_id,
                         case when ce.to_status in ('accepted', 'declined') then c.opponent_id else c.challenger_id end)),
                'opp', public.ff_team_label(public.ff_seat_team(p_league_id,
                         case when ce.to_status in ('accepted', 'declined') then c.challenger_id else c.opponent_id end)),
                'winner', public.ff_team_label(public.ff_seat_team(p_league_id, c.winner_id)),
                'title', c.title,
                'stake', c.stake_label,
                'challenge_id', c.id,
                'matchup_id', c.matchup_id) as x
         from challenge_events ce
         join challenges c on c.id = ce.challenge_id
        where c.league_id = p_league_id
          and ce.created_at > now() - interval '7 days'
          and ce.to_status in ('proposed', 'accepted', 'declined', 'resolved')
        order by ce.created_at desc
        limit 20)
      union all
      (select lm.created_at, jsonb_build_object(
                'id', 'msg:' || lm.id,
                'kind', 'chat',
                'at', lm.created_at,
                'verb', 'said',
                'who', public.ff_team_label(public.ff_seat_team(p_league_id, lm.author_id)),
                'body', lm.body,
                'reactions', rx.n,
                'message_id', lm.id,
                'sunday_event_id', lm.sunday_event_id) as x
         from league_messages lm
         cross join lateral (select count(*) as n from reactions r
                              where r.source = 'message' and r.target_id = lm.id) rx
        where lm.league_id = p_league_id and lm.kind = 'manager'
          and lm.created_at > now() - interval '2 days'
          and (lm.sunday_event_id is not null or rx.n >= 3)
        order by lm.created_at desc
        limit 20)
    ) a;

  -- What the league knows that one week's board does not.
  select settings into v_settings from leagues where id = p_league_id;
  v_intel := jsonb_build_object(
    'weights', public.ff_sunday_weights(p_league_id),
    'can_tune', (select commissioner_id from leagues where id = p_league_id) = v_uid,
    'rules', coalesce(public.ff_rules_for_week(p_league_id, v_week), '{}'::jsonb),
    'playoff_teams', coalesce((v_settings->>'playoff_teams')::int, 6),
    'regular_season_weeks', coalesce((v_settings->>'regular_season_weeks')::int, 14),
    'table', coalesce((select jsonb_agg(jsonb_build_object(
                'team_id', t.team_id, 'wins', t.wins, 'losses', t.losses, 'ties', t.ties,
                'pf', t.pf, 'rank', t.rank, 'streak', t.streak) order by t.rank)
              from public.ff_sunday_table(p_league_id, v_season, v_week) t), '[]'::jsonb),
    'season_high', public.ff_sunday_season_high(p_league_id, v_season, v_week),
    'h2h', coalesce((select jsonb_object_agg(m.id, h.j)
              from matchups m
              join teams th on th.id = m.home_team_id
              join teams ta on ta.id = m.away_team_id
              cross join lateral (select public.ff_sunday_h2h(p_league_id,
                                    coalesce(th.manager_name, th.name), coalesce(ta.manager_name, ta.name),
                                    v_season, v_week) as j) h
             where m.league_id = p_league_id and m.week = v_week and h.j is not null), '{}'::jsonb)
  );

  return v_board || jsonb_build_object('nfl', v_nfl, 'events', v_events, 'activity', v_activity, 'intel', v_intel);
end $fn$;

revoke all on function public.ff_sunday(uuid, integer) from public, anon;
grant execute on function public.ff_sunday(uuid, integer) to authenticated;

comment on function public.ff_sunday(uuid, integer) is
  'Steakhouse Sunday: ff_scoreboard for the week plus `nfl`, `events` (each with reactions and talk), `activity`, and `intel` — the weights, scoring rules, the table going into the week, the season high and each pairing''s head-to-head. Members only, by way of ff_scoreboard''s own guard.';
