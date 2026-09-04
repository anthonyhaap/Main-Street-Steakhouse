-- Switch the primary stats feed to Sleeper.
--
-- Why: Sleeper publishes fantasy-shaped weekly stat lines for every player AND
-- all 32 team defenses (keyed by abbreviation), including the things ESPN's box
-- score simply does not carry: 2-point conversions, points-allowed brackets,
-- and team defensive totals. It also ships pts_ppr / pts_half_ppr / pts_std --
-- its own computed fantasy points -- which we keep as `ref_points` so our
-- scoring engine always has a ground-truth oracle to diff against.
--
-- ESPN stays in the stack for GAME STATE (kickoff times, in/post status) which
-- drives per-player lineup lock. Each source does what it is best at.

-- Sleeper stats are per-week, not per-game, so the game link becomes optional
-- and the week becomes the natural key.
alter table player_stat_lines alter column game_id drop not null;
alter table player_stat_lines drop constraint player_stat_lines_player_id_game_id_key;
alter table player_stat_lines add column source text not null default 'sleeper';
alter table player_stat_lines add column ref_points numeric;   -- Sleeper's own pts_ppr
alter table player_stat_lines add constraint player_stat_lines_week_key
  unique (player_id, season, season_type, week, source);

-- ------------------------------------------------------------
-- Crosswalk: Sleeper player_id -> our players (via gsis_id, or team abbr for DEF)
-- ------------------------------------------------------------
create or replace function ff_load_sleeper_players()
returns table (mapped int, def_mapped int, unmatched int)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_body text; v_mapped int; v_def int; v_unmatched int;
begin
  select content into v_body from extensions.http_get('https://api.sleeper.app/v1/players/nfl');
  if v_body is null or length(v_body) < 100000 then
    raise exception 'sleeper players fetch returned % bytes', coalesce(length(v_body),0);
  end if;

  create temp table _sl on commit drop as
  select e.key as sleeper_id,
         nullif(e.value->>'gsis_id','')   as gsis_id,
         nullif(e.value->>'team','')      as team,
         e.value->>'position'             as position
  from jsonb_each(v_body::jsonb) e;

  -- skill players and kickers, matched on the canonical NFL id
  with m as (
    insert into player_id_map (player_id, source, source_id)
    select p.id, 'sleeper', s.sleeper_id
    from _sl s join players p on p.gsis_id = s.gsis_id
    where s.gsis_id is not null and s.position <> 'DEF'
    on conflict (source, source_id) do update set player_id = excluded.player_id
    returning 1
  ) select count(*) into v_mapped from m;

  -- team defenses: Sleeper keys them by abbreviation ('KC'), we store 'DST-KC'
  with d as (
    insert into player_id_map (player_id, source, source_id)
    select p.id, 'sleeper', s.sleeper_id
    from _sl s join players p on p.gsis_id = 'DST-' || s.sleeper_id
    where s.position = 'DEF'
    on conflict (source, source_id) do update set player_id = excluded.player_id
    returning 1
  ) select count(*) into v_def from d;

  select count(*) into v_unmatched
  from _sl s
  where s.position in ('QB','RB','WR','TE','K')
    and (s.gsis_id is null or not exists (select 1 from players p where p.gsis_id = s.gsis_id))
    and s.team is not null;

  insert into ingest_log (source, event, detail)
  values ('sleeper','players_mapped',
          jsonb_build_object('mapped',v_mapped,'def',v_def,'unmatched_rostered',v_unmatched));

  return query select v_mapped, v_def, v_unmatched;
end; $$;

-- ------------------------------------------------------------
-- Weekly stat lines. Safe to call every 30s during games: it upserts.
-- ------------------------------------------------------------
create or replace function ff_load_sleeper_stats(
  p_season int, p_week int, p_season_type text default 'regular'
) returns table (lines int, unmapped int)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_body text; v_type int; v_lines int; v_unmapped int;
begin
  select content into v_body from extensions.http_get(
    format('https://api.sleeper.app/v1/stats/nfl/%s/%s/%s', p_season_type, p_season, p_week));
  if v_body is null or v_body = 'null' or length(v_body) < 100 then
    raise exception 'sleeper stats % % % returned % bytes',
      p_season_type, p_season, p_week, coalesce(length(v_body),0);
  end if;

  v_type := case p_season_type when 'pre' then 1 when 'post' then 3 else 2 end;

  create temp table _st on commit drop as
  select e.key as sleeper_id, e.value as stats from jsonb_each(v_body::jsonb) e;

  with up as (
    insert into player_stat_lines
      (player_id, season, season_type, week, stats, ref_points, source, updated_at, revision)
    select m.player_id, p_season, v_type, p_week, s.stats,
           (s.stats->>'pts_ppr')::numeric, 'sleeper', now(), 1
    from _st s
    join player_id_map m on m.source = 'sleeper' and m.source_id = s.sleeper_id
    on conflict (player_id, season, season_type, week, source) do update
      set stats      = excluded.stats,
          ref_points = excluded.ref_points,
          revision   = player_stat_lines.revision + 1,
          updated_at = now()
    returning 1
  ) select count(*) into v_lines from up;

  select count(*) into v_unmapped from _st s
  where not exists (select 1 from player_id_map m
                    where m.source='sleeper' and m.source_id = s.sleeper_id);

  insert into ingest_log (source, event, detail)
  values ('sleeper','stats_loaded',
          jsonb_build_object('season',p_season,'week',p_week,'type',p_season_type,
                             'lines',v_lines,'unmapped',v_unmapped));

  return query select v_lines, v_unmapped;
end; $$;

revoke execute on function ff_load_sleeper_players() from anon, authenticated;
revoke execute on function ff_load_sleeper_stats(int,int,text) from anon, authenticated;