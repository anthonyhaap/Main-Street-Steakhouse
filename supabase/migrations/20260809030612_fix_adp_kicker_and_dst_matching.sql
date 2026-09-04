-- Two mismatches, both trivial once seen:
--   * FFC calls kickers 'PK', we call them 'K'
--   * FFC names defenses "Denver Defense", so match those on team abbreviation
--     rather than on the name at all.
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
         case e->>'position' when 'DEF' then 'DST' when 'PK' then 'K' else e->>'position' end as position,
         nullif(e->>'team','') as team,
         (e->>'adp')::numeric as adp,
         row_number() over (order by (e->>'adp')::numeric) as overall_rank
  from jsonb_array_elements((v_body::jsonb)->'players') e;

  drop table if exists _adp_match;
  create temp table _adp_match on commit drop as
  select distinct on (p.id) p.id as player_id, a.adp, a.overall_rank
  from _adp a
  join players p
    on p.position = a.position
   and (
        -- defenses match on team, never on name
        (a.position = 'DST' and p.nfl_team = a.team)
        or
        (a.position <> 'DST' and ff_norm_name(p.full_name) = a.nname
         and (a.team is null or p.nfl_team is null or p.nfl_team = a.team))
       )
  order by p.id, a.adp;

  with m as (
    insert into player_adp (player_id, format, teams, season, adp, overall_rank, snapshot_at)
    select player_id, p_format, p_teams, p_season, adp, overall_rank, now() from _adp_match
    on conflict (player_id, format, teams, season) do update
      set adp = excluded.adp, overall_rank = excluded.overall_rank, snapshot_at = now()
    returning 1
  ) select count(*) into v_matched from m;

  select count(*) into v_unmatched from _adp a
  where not exists (
    select 1 from players p where p.position = a.position
      and ((a.position = 'DST' and p.nfl_team = a.team)
        or (a.position <> 'DST' and ff_norm_name(p.full_name) = a.nname)));

  insert into ingest_log (source, event, detail)
  values ('ffcalculator','adp_loaded',
          jsonb_build_object('matched',v_matched,'unmatched',v_unmatched,'format',p_format));

  return query select v_matched, v_unmatched;
end; $$;

revoke execute on function ff_load_adp(int,text,int) from anon, authenticated;