alter table players add column sleeper_id text unique;
create index players_sleeper_idx on players (sleeper_id);

insert into nfl_teams (id, name, espn_id) values ('WAS','Washington Commanders','WSH')
on conflict (id) do update set espn_id = excluded.espn_id;

update players set nfl_team = 'WAS' where nfl_team = 'WSH';
update players set gsis_id = 'DST-WAS' where gsis_id = 'DST-WSH';
delete from nfl_teams where id = 'WSH';
update nfl_teams set espn_id = id where espn_id is null;

create or replace function ff_load_sleeper_players()
returns table (upserted int, defenses int, still_unmapped int)
language plpgsql security definer set search_path = public, extensions as $$
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
         coalesce(nullif(e.value->>'status',''),'Active') as status
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
                         position, nfl_team, status)
    select s.sleeper_id, s.gsis_id, s.full_name, s.first_name, s.last_name,
           case when s.position = 'DEF' then 'DST' else s.position end,
           s.team,
           case when s.status = 'Active' then 'ACT' else upper(left(s.status,3)) end
    from _sl s
    on conflict (sleeper_id) do update
      set full_name  = excluded.full_name,
          position   = excluded.position,
          nfl_team   = excluded.nfl_team,
          status     = excluded.status,
          updated_at = now()
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
end; $$;

revoke execute on function ff_load_sleeper_players() from anon, authenticated;