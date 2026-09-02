-- ============================================================================
-- Projections.
--
-- Every lineup decision is a forecast, and until now the app offered none: it
-- could tell a manager what a player *did* and left him to guess the rest. Any
-- other fantasy site would have shown a projected score next to the name.
--
-- Sleeper publishes projections on the same endpoint shape as the actuals we
-- already ingest — `/v1/projections/nfl/{type}/{season}/{week}`, keyed by the
-- same player ids, carrying the same stat keys. That matters more than the
-- convenience: because the keys match, `ff_score` scores a projection with the
-- league's own rules exactly as it scores a real stat line. The number a
-- manager sees is what the projection is worth *here*, not a PPR figure lifted
-- off someone else's settings.
--
-- Projections live in their own table rather than a flag on player_stat_lines.
-- They have a different lifecycle — rewritten every day until kickoff, then
-- frozen and interesting only as a thing to compare against — and mixing them
-- into the table the scoreboard reads from is how a projection ends up on a
-- scoreboard.
-- ============================================================================

create table if not exists public.player_projections (
  player_id   uuid not null references public.players(id) on delete cascade,
  season      integer not null,
  season_type integer not null default 2,
  week        integer not null,
  stats       jsonb   not null,
  /** The source's own PPR number, kept for sanity-checking our scoring. */
  ref_points  numeric,
  source      text    not null default 'sleeper',
  updated_at  timestamptz not null default now(),
  primary key (player_id, season, season_type, week, source)
);

create index if not exists player_projections_week_idx
  on public.player_projections (season, season_type, week);

alter table public.player_projections enable row level security;

drop policy if exists player_projections_read on public.player_projections;
create policy player_projections_read on public.player_projections for select using (true);

grant select on public.player_projections to authenticated, anon;

comment on table public.player_projections is
  'Weekly per-player projections from Sleeper, in the same stat shape as player_stat_lines so ff_score can price them with league rules.';

-- ----------------------------------------------------------------------------
-- ff_load_sleeper_projections — a deliberate twin of ff_load_sleeper_stats.
--
-- Same fetch, same guard on a short body, same id-map join, same unmapped
-- count. Kept parallel on purpose: when the stats loader needs a fix, whoever
-- is looking at it should be able to see that this one needs the same fix.
-- ----------------------------------------------------------------------------

create or replace function public.ff_load_sleeper_projections(
  p_season integer, p_week integer, p_season_type text default 'regular')
returns table(lines integer, unmapped integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_body text; v_type int; v_lines int; v_unmapped int;
begin
  select content into v_body from extensions.http_get(
    format('https://api.sleeper.app/v1/projections/nfl/%s/%s/%s', p_season_type, p_season, p_week));
  if v_body is null or v_body = 'null' or length(v_body) < 100 then
    raise exception 'sleeper projections % % % returned % bytes',
      p_season_type, p_season, p_week, coalesce(length(v_body),0);
  end if;

  v_type := case p_season_type when 'pre' then 1 when 'post' then 3 else 2 end;

  drop table if exists _pj;
  create temp table _pj on commit drop as
  select e.key as sleeper_id, e.value as stats from jsonb_each(v_body::jsonb) e;

  with up as (
    insert into player_projections
      (player_id, season, season_type, week, stats, ref_points, source, updated_at)
    select m.player_id, p_season, v_type, p_week, s.stats,
           (s.stats->>'pts_ppr')::numeric, 'sleeper', now()
    from _pj s
    join player_id_map m on m.source = 'sleeper' and m.source_id = s.sleeper_id
    on conflict (player_id, season, season_type, week, source) do update
      set stats      = excluded.stats,
          ref_points = excluded.ref_points,
          updated_at = now()
    returning 1
  ) select count(*) into v_lines from up;

  select count(*) into v_unmapped from _pj s
  where not exists (select 1 from player_id_map m
                     where m.source = 'sleeper' and m.source_id = s.sleeper_id);

  insert into ingest_log (source, event, detail)
  values ('sleeper', 'projections',
          jsonb_build_object('season', p_season, 'week', p_week,
                             'lines', v_lines, 'unmapped', v_unmapped));

  return query select v_lines, v_unmapped;
end $$;

-- ----------------------------------------------------------------------------
-- ff_refresh_projections — what the cron calls.
--
-- Projections are only worth re-pulling for weeks that have not been played.
-- This takes the current week and the next one: the current week because it
-- moves all week as practice reports land, and the next because that is the
-- week a manager is planning when the current one is already locked.
-- ----------------------------------------------------------------------------

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

  return jsonb_build_object('season', v_season, 'weeks', v_done);
end $$;

revoke all on function public.ff_load_sleeper_projections(integer, integer, text) from public;
revoke all on function public.ff_refresh_projections() from public;
