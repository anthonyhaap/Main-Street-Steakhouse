-- ============================================================================
-- Player bio, and a depth chart we don't have to guess at.
--
-- `players` carried a name, a position, a club and a bye week. That is enough
-- to fill a draft board and nothing else — you cannot open a player and learn
-- anything about him, because there is nothing to learn.
--
-- Sleeper's player index already carries the rest, on the same endpoint the
-- pool loader has always read: age, height, weight, college, jersey, years in
-- the league, the club's own depth-chart order, and the current injury
-- designation. It is one fetch we were already making and throwing most of
-- away.
--
-- The depth chart matters beyond the bio. `ff_team_hub` inferred "RB2 of 4"
-- from draft-market rank, which is a proxy for how the market values a player
-- rather than where his own coaching staff has him. `depth_chart_order` is the
-- real thing, so the opportunity engine can stop guessing which back is ahead
-- of yours.
-- ============================================================================

alter table public.players
  add column if not exists jersey              smallint,
  add column if not exists age                 smallint,
  add column if not exists birth_date          date,
  add column if not exists height_in           smallint,
  add column if not exists weight_lb           smallint,
  add column if not exists college             text,
  add column if not exists high_school         text,
  add column if not exists years_exp           smallint,
  add column if not exists rookie_year         smallint,
  add column if not exists depth_chart_order   smallint,
  add column if not exists depth_chart_pos     text,
  add column if not exists injury_status       text,
  add column if not exists injury_body_part    text,
  add column if not exists injury_notes        text,
  -- Sleeper's own relevance rank. Low is more talked about; it is the least
  -- bad tiebreaker for "which Josh Allen did you mean" in a search box.
  add column if not exists search_rank         integer,
  add column if not exists news_updated_at     timestamptz;

comment on column public.players.height_in is 'Height in inches, parsed from Sleeper''s free-text height.';
comment on column public.players.depth_chart_order is 'The club''s own depth chart, per Sleeper. 1 is the starter.';

-- Height arrives as "74", or occasionally as "6''2" — parse both, keep null
-- rather than storing a number we made up.
create or replace function public.ff_height_inches(p_raw text)
returns smallint language sql immutable as $$
  select case
    when p_raw is null or btrim(p_raw) = '' then null
    when p_raw ~ '^\s*\d+\s*$' and (p_raw::numeric between 60 and 90) then p_raw::numeric::smallint
    when p_raw ~ '^\s*(\d+)\s*''\s*(\d+)' then
      ((substring(p_raw from '^\s*(\d+)'))::int * 12
       + (substring(p_raw from '''\s*(\d+)'))::int)::smallint
    else null
  end
$$;

-- ----------------------------------------------------------------------------
-- The pool loader, now keeping what it reads.
--
-- Everything above the bio columns is unchanged from the version this replaces:
-- same gsis/defense id reconciliation, same upsert keys, same id map writes.
-- ----------------------------------------------------------------------------

create or replace function public.ff_load_sleeper_players()
returns table(upserted integer, defenses integer, still_unmapped integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_body text; v_up int; v_def int; v_un int;
begin
  select content into v_body from extensions.http_get('https://api.sleeper.app/v1/players/nfl');
  if v_body is null or length(v_body) < 100000 then
    raise exception 'sleeper players fetch returned % bytes', coalesce(length(v_body),0);
  end if;

  create temp table _sl on commit drop as
  select e.key as sleeper_id,
         nullif(e.value->>'gsis_id','') as gsis_id,
         nullif(e.value->>'espn_id','') as espn_id,
         coalesce(nullif(e.value->>'full_name',''),
                  trim(coalesce(e.value->>'first_name','') || ' ' ||
                       coalesce(e.value->>'last_name',''))) as full_name,
         nullif(e.value->>'first_name','') as first_name,
         nullif(e.value->>'last_name','')  as last_name,
         nullif(e.value->>'team','')       as team,
         e.value->>'position'              as position,
         coalesce(nullif(e.value->>'status',''),'Active') as status,
         -- bio
         (e.value->>'number')::numeric::smallint            as jersey,
         (e.value->>'age')::numeric::smallint               as age,
         nullif(e.value->>'birth_date','')::date            as birth_date,
         public.ff_height_inches(e.value->>'height')        as height_in,
         nullif(regexp_replace(coalesce(e.value->>'weight',''), '\D', '', 'g'), '')::numeric::smallint as weight_lb,
         nullif(e.value->>'college','')                     as college,
         nullif(e.value->>'high_school','')                 as high_school,
         (e.value->>'years_exp')::numeric::smallint         as years_exp,
         nullif(e.value->'metadata'->>'rookie_year','')::numeric::smallint as rookie_year,
         (e.value->>'depth_chart_order')::numeric::smallint as depth_chart_order,
         nullif(e.value->>'depth_chart_position','')        as depth_chart_pos,
         nullif(e.value->>'injury_status','')               as injury_status,
         nullif(e.value->>'injury_body_part','')            as injury_body_part,
         nullif(e.value->>'injury_notes','')                as injury_notes,
         (e.value->>'search_rank')::numeric::integer        as search_rank,
         case when (e.value->>'news_updated') ~ '^\d+$'
              then to_timestamp((e.value->>'news_updated')::bigint / 1000.0) end as news_updated_at
  from jsonb_each(v_body::jsonb) e
  where e.value->>'position' in ('QB','RB','WR','TE','K','DEF')
    and nullif(e.value->>'team','') is not null;

  update players p set sleeper_id = s.sleeper_id
  from _sl s
  where s.gsis_id is not null and p.gsis_id = s.gsis_id and p.sleeper_id is null;

  update players p set sleeper_id = s.sleeper_id
  from _sl s
  where s.position = 'DEF' and p.gsis_id = 'DST-' || s.sleeper_id and p.sleeper_id is null;

  with up as (
    insert into players (sleeper_id, gsis_id, full_name, first_name, last_name,
                         position, nfl_team, status,
                         jersey, age, birth_date, height_in, weight_lb, college,
                         high_school, years_exp, rookie_year, depth_chart_order,
                         depth_chart_pos, injury_status, injury_body_part,
                         injury_notes, search_rank, news_updated_at)
    select s.sleeper_id, s.gsis_id, s.full_name, s.first_name, s.last_name,
           case when s.position = 'DEF' then 'DST' else s.position end,
           s.team,
           case when s.status = 'Active' then 'ACT' else upper(left(s.status,3)) end,
           s.jersey, s.age, s.birth_date, s.height_in, s.weight_lb, s.college,
           s.high_school, s.years_exp, s.rookie_year, s.depth_chart_order,
           s.depth_chart_pos, s.injury_status, s.injury_body_part,
           s.injury_notes, s.search_rank, s.news_updated_at
    from _sl s
    on conflict (sleeper_id) do update
      set full_name         = excluded.full_name,
          position          = excluded.position,
          nfl_team          = excluded.nfl_team,
          status            = excluded.status,
          jersey            = excluded.jersey,
          age               = excluded.age,
          birth_date        = excluded.birth_date,
          height_in         = excluded.height_in,
          weight_lb         = excluded.weight_lb,
          college           = excluded.college,
          high_school       = excluded.high_school,
          years_exp         = excluded.years_exp,
          rookie_year       = excluded.rookie_year,
          depth_chart_order = excluded.depth_chart_order,
          depth_chart_pos   = excluded.depth_chart_pos,
          -- Injury fields are cleared as well as set: a player who has come off
          -- the report must stop being questionable in our copy too.
          injury_status     = excluded.injury_status,
          injury_body_part  = excluded.injury_body_part,
          injury_notes      = excluded.injury_notes,
          search_rank       = excluded.search_rank,
          news_updated_at   = excluded.news_updated_at,
          updated_at        = now()
    returning 1
  ) select count(*) into v_up from up;

  insert into player_id_map (player_id, source, source_id)
  select p.id, 'espn', s.espn_id
  from _sl s join players p on p.sleeper_id = s.sleeper_id
  where s.espn_id is not null
  on conflict (source, source_id) do update set player_id = excluded.player_id;

  insert into player_id_map (player_id, source, source_id)
  select p.id, 'sleeper', p.sleeper_id from players p where p.sleeper_id is not null
  on conflict (source, source_id) do update set player_id = excluded.player_id;

  select count(*) into v_def from players where position = 'DST' and sleeper_id is not null;
  select count(*) into v_un from _sl s
    where not exists (select 1 from players p where p.sleeper_id = s.sleeper_id);

  insert into ingest_log (source, event, detail)
  values ('sleeper','pool_loaded', jsonb_build_object('upserted',v_up,'defenses',v_def,'unmapped',v_un));

  return query select v_up, v_def, v_un;
end $$;
