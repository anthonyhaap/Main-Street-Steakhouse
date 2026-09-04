-- Let the database pull its own reference data. The nflverse players release is
-- the canonical cross-platform ID source (gsis <-> espn <-> pfr <-> sleeper).
-- Re-runnable: gsis_id is the natural key.

-- Quote-aware CSV field splitter. Regex-speed, not a plpgsql character loop,
-- because the players release is ~25k rows.
create or replace function ff_csv_split(p_line text)
returns text[] language sql immutable as $$
  select array_agg(coalesce(replace(m[1], '""', '"'), m[2]) order by ord)
  from regexp_matches(p_line || ',', '(?:"((?:[^"]|"")*)"|([^",]*)),', 'g')
       with ordinality as t(m, ord)
$$;

create or replace function ff_load_nflverse_players(
  p_min_last_season int default 2025,
  p_url text default 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'
) returns table (loaded int, mapped int, missing_espn int)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_body text;
  v_loaded int;
  v_mapped int;
  v_missing int;
begin
  select content into v_body from extensions.http_get(p_url);
  if v_body is null or length(v_body) < 1000 then
    raise exception 'nflverse fetch returned % bytes', coalesce(length(v_body), 0);
  end if;

  create temp table _nfl_raw on commit drop as
  select ff_csv_split(line) as f
  from unnest(string_to_array(v_body, E'\n')) with ordinality as t(line, ord)
  where ord > 1 and length(line) > 20;

  create temp table _nfl_players on commit drop as
  select
    f[1]  as gsis_id,
    f[2]  as full_name,
    f[14] as espn_id,
    case when f[18] = 'PK' then 'K' when f[18] = 'FB' then 'RB' else f[18] end as position,
    nullif(f[29], '') as nfl_team,
    f[30] as status,
    nullif(f[28], '')::int as last_season
  from _nfl_raw
  where f[1] is not null and f[1] <> ''
    and f[18] in ('QB','RB','WR','TE','K','PK','FB')
    and nullif(f[28], '') is not null
    and nullif(f[28], '')::int >= p_min_last_season;

  with upserted as (
    insert into players (gsis_id, full_name, position, nfl_team, status)
    select gsis_id, full_name, position, null, status from _nfl_players
    on conflict (gsis_id) do update
      set full_name = excluded.full_name,
          position  = excluded.position,
          status    = excluded.status,
          updated_at = now()
    returning id, gsis_id
  ), crosswalk as (
    insert into player_id_map (player_id, source, source_id)
    select u.id, 'espn', p.espn_id
    from upserted u join _nfl_players p on p.gsis_id = u.gsis_id
    where nullif(p.espn_id, '') is not null
    on conflict (source, source_id) do update set player_id = excluded.player_id
    returning 1
  )
  select (select count(*) from _nfl_players), (select count(*) from crosswalk)
    into v_loaded, v_mapped;

  select count(*) into v_missing from _nfl_players where nullif(espn_id, '') is null;

  insert into ingest_log (source, event, detail)
  values ('nflverse', 'players_loaded',
          jsonb_build_object('loaded', v_loaded, 'mapped', v_mapped, 'missing_espn', v_missing));

  return query select v_loaded, v_mapped, v_missing;
end; $$;