-- Calling the loader more than once inside a single transaction (e.g. backfilling
-- a range of weeks) collided on the temp table. Drop it up front.
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

  drop table if exists _st;
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

revoke execute on function ff_load_sleeper_stats(int,int,text) from anon, authenticated;