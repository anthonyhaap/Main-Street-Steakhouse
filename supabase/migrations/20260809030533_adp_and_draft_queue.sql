-- ADP powers autopick. Snapshot it into our own tables: never depend on a third
-- party being up at 7pm on draft night.
create table if not exists draft_queue (
  team_id    uuid not null references teams(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  rank       int  not null,
  created_at timestamptz not null default now(),
  primary key (team_id, player_id)
);
create index draft_queue_team_idx on draft_queue (team_id, rank);
alter table draft_queue enable row level security;
create policy draft_queue_read on draft_queue for select to authenticated using (true);

-- Normalise names so "A.J. Brown", "AJ Brown" and "Aj Brown Jr." collapse.
create or replace function ff_norm_name(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(lower(coalesce(p,'')), '\s+(jr|sr|ii|iii|iv|v)\.?$', ''),
           '[^a-z]', '', 'g')
$$;

create or replace function ff_load_adp(
  p_season int default 2026, p_format text default 'ppr', p_teams int default 12
) returns table (matched int, unmatched int)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_body text; v_matched int; v_unmatched int;
begin
  select content into v_body from extensions.http_get(format(
    'https://fantasyfootballcalculator.com/api/v1/adp/%s?teams=%s&year=%s&position=all',
    p_format, p_teams, p_season));
  if v_body is null or length(v_body) < 500 then
    raise exception 'ADP fetch returned % bytes', coalesce(length(v_body),0);
  end if;

  drop table if exists _adp;
  create temp table _adp on commit drop as
  select ff_norm_name(e->>'name') as nname,
         case when e->>'position' = 'DEF' then 'DST' else e->>'position' end as position,
         nullif(e->>'team','') as team,
         (e->>'adp')::numeric as adp,
         row_number() over (order by (e->>'adp')::numeric) as overall_rank
  from jsonb_array_elements((v_body::jsonb)->'players') e;

  with m as (
    insert into player_adp (player_id, format, teams, season, adp, overall_rank, snapshot_at)
    select distinct on (p.id) p.id, p_format, p_teams, p_season, a.adp, a.overall_rank, now()
    from _adp a
    join players p
      on p.position = a.position
     and ff_norm_name(p.full_name) = a.nname
     and (a.team is null or p.nfl_team is null or p.nfl_team = a.team)
    order by p.id, a.adp
    on conflict (player_id, format, teams, season) do update
      set adp = excluded.adp, overall_rank = excluded.overall_rank, snapshot_at = now()
    returning 1
  ) select count(*) into v_matched from m;

  select count(*) into v_unmatched from _adp a
  where not exists (
    select 1 from players p
    where p.position = a.position and ff_norm_name(p.full_name) = a.nname);

  insert into ingest_log (source, event, detail)
  values ('ffcalculator','adp_loaded',
          jsonb_build_object('matched',v_matched,'unmatched',v_unmatched,'format',p_format));

  return query select v_matched, v_unmatched;
end; $$;

revoke execute on function ff_load_adp(int,text,int) from anon, authenticated;