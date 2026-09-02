-- ============================================================================
-- Season projections, for the one screen that needs them most.
--
-- `player_projections` holds a row per player per week, which is the right
-- shape for a lineup decision and the wrong one for a draft board. On draft
-- night nobody asks what a man will score in week 6; they ask what he is worth
-- for the year, and they ask it about four hundred players at once while a
-- clock runs.
--
-- Summing eighteen weeks through ff_score on every keystroke of the search box
-- is not that. So the total is computed once, by cron, into a table the draft
-- pool can join to for free.
--
-- Two totals are kept because they answer different questions:
--
--   points_total     — the whole season. What you draft on.
--   points_remaining — from the current week forward. What a waiver claim in
--                      week 9 is actually worth, when eight weeks of the
--                      season are already spent.
--
-- Before kickoff the two are identical, which is the correct behaviour rather
-- than a coincidence to paper over.
-- ============================================================================

create table if not exists public.player_season_projections (
  player_id        uuid not null references public.players(id) on delete cascade,
  season           integer not null,
  /** Every week we hold a projection for, scored with this league's rules. */
  points_total     numeric not null default 0,
  /** Current week forward, on the same scoring. */
  points_remaining numeric not null default 0,
  weeks            integer not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (player_id, season)
);

alter table public.player_season_projections enable row level security;

drop policy if exists player_season_projections_read on public.player_season_projections;
create policy player_season_projections_read
  on public.player_season_projections for select using (true);

grant select on public.player_season_projections to authenticated, anon;

comment on table public.player_season_projections is
  'Season projection totals, priced with league rules. Rebuilt by cron so the draft board can join rather than aggregate.';

-- ----------------------------------------------------------------------------
-- ff_rebuild_season_projections — fold the weekly rows into the two totals.
--
-- Scoring is done here, once per refresh, rather than on read. Weekly rules are
-- respected: ff_rules_for_week is called per week, so a league that changes
-- scoring mid-season still gets an honest total.
-- ----------------------------------------------------------------------------

create or replace function public.ff_rebuild_season_projections(p_season integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_league  leagues%rowtype;
  v_season  integer;
  v_week    integer;
  v_rows    integer;
begin
  select * into v_league from leagues order by created_at limit 1;
  v_season := coalesce(p_season, v_league.season);
  v_week   := public.ff_current_week();

  with scored as (
    select pj.player_id,
           pj.week,
           round(public.ff_score(pj.stats, public.ff_rules_for_week(v_league.id, pj.week)), 2) as pts
      from player_projections pj
     where pj.season = v_season and pj.season_type = 2 and pj.source = 'sleeper'
  ),
  folded as (
    select player_id,
           round(sum(pts), 2)                                      as total,
           round(coalesce(sum(pts) filter (where week >= v_week), 0), 2) as remaining,
           count(*)                                                as weeks
      from scored
     group by player_id
  ),
  up as (
    insert into player_season_projections
      (player_id, season, points_total, points_remaining, weeks, updated_at)
    select player_id, v_season, total, remaining, weeks, now() from folded
    on conflict (player_id, season) do update
      set points_total     = excluded.points_total,
          points_remaining = excluded.points_remaining,
          weeks            = excluded.weeks,
          updated_at       = now()
    returning 1
  )
  select count(*) into v_rows from up;

  insert into ingest_log (source, event, detail)
  values ('sleeper', 'season_projections',
          jsonb_build_object('season', v_season, 'players', v_rows, 'from_week', v_week));

  return jsonb_build_object('season', v_season, 'players', v_rows);
end $$;

-- ----------------------------------------------------------------------------
-- ff_load_season_projections — pull every week that has not been played.
--
-- Sleeper revises the whole remaining season as the picture changes, so weeks
-- already behind us are left alone (their projections are settled and their
-- actuals are what matter now) and everything from the current week forward is
-- re-pulled. One failed week does not abandon the rest.
-- ----------------------------------------------------------------------------

create or replace function public.ff_load_season_projections()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_season int; v_week int; w int;
  v_ok int := 0; v_failed int := 0; v_lines int; v_unmapped int;
begin
  select max(season) into v_season from leagues;
  v_week := public.ff_current_week();

  for w in greatest(1, v_week)..18 loop
    begin
      select lines, unmapped into v_lines, v_unmapped
        from ff_load_sleeper_projections(v_season, w, 'regular');
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into ingest_log (source, event, detail)
      values ('sleeper', 'projections_failed',
              jsonb_build_object('season', v_season, 'week', w, 'error', sqlerrm));
    end;
  end loop;

  perform public.ff_rebuild_season_projections(v_season);

  return jsonb_build_object('season', v_season, 'weeks_loaded', v_ok, 'weeks_failed', v_failed);
end $$;

-- The six-hourly job keeps the near weeks sharp; rebuild the totals with it so
-- the board never lags the lineup.
create or replace function public.ff_refresh_projections()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_season int; v_week int; v_done jsonb := '[]'::jsonb;
  v_lines int; v_unmapped int; w int;
begin
  select max(season) into v_season from leagues;
  v_week := public.ff_current_week();

  foreach w in array array[v_week, v_week + 1] loop
    if w between 1 and 18 then
      begin
        select lines, unmapped into v_lines, v_unmapped
          from ff_load_sleeper_projections(v_season, w, 'regular');
        v_done := v_done || jsonb_build_object('week', w, 'lines', v_lines);
      exception when others then
        insert into ingest_log (source, event, detail)
        values ('sleeper', 'projections_failed',
                jsonb_build_object('season', v_season, 'week', w, 'error', sqlerrm));
      end;
    end if;
  end loop;

  perform public.ff_rebuild_season_projections(v_season);

  return jsonb_build_object('season', v_season, 'weeks', v_done);
end $$;

revoke all on function public.ff_rebuild_season_projections(integer) from public;
revoke all on function public.ff_load_season_projections() from public;

-- Whole-season pull once a day; it is eighteen fetches and nothing on the board
-- moves faster than that.
select cron.schedule('projections-season', '10 9 * * *',
                     'select public.ff_load_season_projections()');

-- ----------------------------------------------------------------------------
-- The draft pool carries the number the board is drafted on.
-- ----------------------------------------------------------------------------

create or replace view public.draft_pool with (security_invoker = true) as
select p.id,
       p.full_name,
       p."position",
       p.nfl_team,
       p.status,
       a.adp,
       a.overall_rank,
       p.bye_week,
       rank() over (partition by p."position"
                    order by coalesce(a.overall_rank, 9999), p.full_name) as position_rank,
       m.source_id     as espn_id,
       p.injury_status,
       p.depth_chart_order,
       sp.points_total     as proj_total,
       sp.points_remaining as proj_remaining
  from players p
  left join player_adp a
    on a.player_id = p.id and a.season = 2026 and a.format = 'ppr' and a.teams = 12
  left join player_id_map m
    on m.player_id = p.id and m.source in ('espn', 'espn_team')
  left join player_season_projections sp
    on sp.player_id = p.id and sp.season = 2026
 where p.status = 'ACT' and p.sleeper_id is not null;
