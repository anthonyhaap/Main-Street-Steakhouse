-- Functions in schema public, extracted live from project ojhjrxolrsppircyrcff
-- Source of truth was the running database; this file makes it reviewable.

CREATE OR REPLACE FUNCTION public.ff_assert_commissioner(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then return; end if;
  if not exists (
    select 1 from leagues
    where id = p_league_id
      and (commissioner_id is null or commissioner_id = auth.uid())
  ) then
    raise exception 'not authorized: commissioner only';
  end if;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_autopick(p_draft_id uuid)
 RETURNS draft_picks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_team uuid; v_player uuid;
begin
  v_team   := ff_team_on_clock(p_draft_id);
  v_player := ff_best_available(p_draft_id, v_team);
  if v_player is null then raise exception 'no players available to autopick'; end if;
  return ff_make_pick(p_draft_id, v_player, v_team, null, true, false);
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_best_available(p_draft_id uuid, p_team_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_league uuid; v_caps jsonb; v_pick uuid;
  v_needs text[]; v_rounds int; v_made int; v_remaining int;
  v_forced text[];
begin
  select league_id, rounds into v_league, v_rounds from drafts where id = p_draft_id;
  select coalesce(settings->'autopick_caps',
                  '{"QB":2,"RB":6,"WR":6,"TE":2,"K":1,"DST":1}'::jsonb)
    into v_caps from leagues where id = v_league;

  -- 1. the team's own queue always wins
  select q.player_id into v_pick
  from draft_queue q
  where q.team_id = p_team_id
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = q.player_id)
  order by q.rank limit 1;
  if v_pick is not null then return v_pick; end if;

  select count(*) into v_made from draft_picks
   where draft_id = p_draft_id and team_id = p_team_id;
  v_remaining := v_rounds - v_made;
  v_needs     := ff_roster_needs(p_draft_id, p_team_id);

  -- 2. endgame: out of slack, so only positions that fill a required slot
  if array_length(v_needs,1) is not null and v_remaining <= array_length(v_needs,1) then
    v_forced := array(
      select distinct case when n = 'FLEX' then null else n end
      from unnest(v_needs) n where n <> 'FLEX');
    if array_length(v_forced,1) is null then
      v_forced := array['RB','WR','TE'];   -- only FLEX left
    end if;

    select p.id into v_pick
    from players p
    left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
    where p.status = 'ACT' and p.position = any(v_forced)
      and not exists (select 1 from draft_picks dp
                      where dp.draft_id = p_draft_id and dp.player_id = p.id)
    order by a.adp nulls last, p.full_name limit 1;
    if v_pick is not null then return v_pick; end if;
  end if;

  -- 3. otherwise best ADP at a position the team is not full at
  select p.id into v_pick
  from players p
  join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
  where p.status = 'ACT'
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = p.id)
    and (select count(*) from draft_picks dp2
         join players p2 on p2.id = dp2.player_id
         where dp2.draft_id = p_draft_id and dp2.team_id = p_team_id
           and p2.position = p.position) < coalesce((v_caps->>p.position)::int, 99)
  order by a.adp limit 1;
  if v_pick is not null then return v_pick; end if;

  -- 4. last resort
  select p.id into v_pick
  from players p
  left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
  where p.status = 'ACT'
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = p.id)
  order by a.adp nulls last, p.full_name limit 1;
  return v_pick;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_claim_commissioner(p_league_id uuid)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_league leagues%rowtype;
begin
  update leagues set commissioner_id = auth.uid()
   where id = p_league_id and commissioner_id is null
  returning * into v_league;
  if not found then select * into v_league from leagues where id = p_league_id; end if;
  return v_league;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_csv_split(p_line text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select array_agg(coalesce(replace(m[1], '""', '"'), m[2]) order by ord)
  from regexp_matches(p_line || ',', '(?:"((?:[^"]|"")*)"|([^",]*)),', 'g')
       with ordinality as t(m, ord)
$function$
;

CREATE OR REPLACE FUNCTION public.ff_generate_schedule(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_teams uuid[]; v_n int; v_weeks int; w int; i int;
  v_rot uuid[]; v_made int := 0; v_home uuid; v_away uuid;
begin
  perform ff_assert_commissioner(p_league_id);
  select array_agg(id order by draft_slot) into v_teams from teams where league_id = p_league_id;
  v_n := array_length(v_teams,1);
  if v_n is null or v_n % 2 = 1 then raise exception 'need an even number of teams, got %', v_n; end if;
  select coalesce((settings->>'regular_season_weeks')::int, 14) into v_weeks
    from leagues where id = p_league_id;

  delete from matchups where league_id = p_league_id;
  v_rot := v_teams;

  for w in 1..v_weeks loop
    for i in 1..(v_n/2) loop
      v_home := v_rot[i];
      v_away := v_rot[v_n + 1 - i];
      if w % 2 = 0 then                       -- alternate home/away by week
        insert into matchups (league_id, week, home_team_id, away_team_id)
        values (p_league_id, w, v_away, v_home);
      else
        insert into matchups (league_id, week, home_team_id, away_team_id)
        values (p_league_id, w, v_home, v_away);
      end if;
      v_made := v_made + 1;
    end loop;
    -- rotate everything except the first entry
    v_rot := array[v_rot[1]] || v_rot[v_n:v_n] || v_rot[2:v_n-1];
  end loop;

  return v_made;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_invite_manager(p_team_id uuid, p_email text)
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v teams%rowtype; v_league uuid;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  perform ff_assert_commissioner(v_league);
  update teams set owner_email = lower(nullif(trim(p_email), '')),
                   owner_id = case when lower(nullif(trim(p_email),'')) is distinct from lower(owner_email)
                                   then null else owner_id end
  where id = p_team_id returning * into v;
  return v;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_link_me()
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v teams%rowtype; v_email text;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return null; end if;

  select * into v from teams where owner_id = auth.uid() limit 1;
  if found then return v; end if;

  update teams set owner_id = auth.uid()
   where lower(owner_email) = v_email and owner_id is null
  returning * into v;
  return v;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_load_adp(p_season integer DEFAULT 2026, p_format text DEFAULT 'ppr'::text, p_teams integer DEFAULT 12)
 RETURNS TABLE(matched integer, unmatched integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_load_nfl_schedule(p_season integer DEFAULT 2026, p_weeks integer DEFAULT 18)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_body text; v_n int := 0; w int;
begin
  for w in 1..p_weeks loop
    select content into v_body from extensions.http_get(format(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=%s&seasontype=2&week=%s',
      p_season, w));
    if v_body is null then continue; end if;

    insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                           kickoff_at, status, status_detail, updated_at)
    select e->>'id', p_season, 2, w,
           ht.abbr, at.abbr,
           (e->>'date')::timestamptz,
           e->'competitions'->0->'status'->'type'->>'state',
           e->'competitions'->0->'status'->'type'->>'shortDetail',
           now()
    from jsonb_array_elements((v_body::jsonb)->'events') e
    cross join lateral (
      select coalesce(t.espn_id, t.id) as espn, t.id as abbr from nfl_teams t
      where coalesce(t.espn_id, t.id) = (
        select c->'team'->>'abbreviation' from jsonb_array_elements(e->'competitions'->0->'competitors') c
        where c->>'homeAway' = 'home')) ht
    cross join lateral (
      select t.id as abbr from nfl_teams t
      where coalesce(t.espn_id, t.id) = (
        select c->'team'->>'abbreviation' from jsonb_array_elements(e->'competitions'->0->'competitors') c
        where c->>'homeAway' = 'away')) at
    on conflict (espn_event_id) do update
      set kickoff_at = excluded.kickoff_at, status = excluded.status,
          status_detail = excluded.status_detail, updated_at = now();
    get diagnostics v_n = row_count;
  end loop;

  select count(*) into v_n from nfl_games where season = p_season and season_type = 2;
  insert into ingest_log (source, event, detail)
  values ('espn','schedule_loaded', jsonb_build_object('season',p_season,'games',v_n));
  return v_n;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_load_nflverse_players(p_min_last_season integer DEFAULT 2025, p_url text DEFAULT 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'::text)
 RETURNS TABLE(loaded integer, mapped integer, missing_espn integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_load_sleeper_players()
 RETURNS TABLE(upserted integer, defenses integer, still_unmapped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_load_sleeper_stats(p_season integer, p_week integer, p_season_type text DEFAULT 'regular'::text)
 RETURNS TABLE(lines integer, unmapped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_lock_time(p_player_id uuid, p_week integer, p_season integer DEFAULT 2026)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select min(g.kickoff_at)
  from players p
  join nfl_games g
    on (g.home_team = p.nfl_team or g.away_team = p.nfl_team)
   and g.season = p_season and g.season_type = 2 and g.week = p_week
  where p.id = p_player_id
$function$
;

CREATE OR REPLACE FUNCTION public.ff_make_pick(p_draft_id uuid, p_player_id uuid, p_team_id uuid DEFAULT NULL::uuid, p_made_by uuid DEFAULT NULL::uuid, p_autopick boolean DEFAULT false, p_force boolean DEFAULT false)
 RETURNS draft_picks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_draft drafts%rowtype; v_count int; v_team uuid; v_round int; v_total int;
  v_pick draft_picks%rowtype; v_onclock uuid;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  if p_force then perform ff_assert_commissioner(v_draft.league_id); end if;
  if v_draft.status = 'complete' then raise exception 'draft is already complete'; end if;
  if v_draft.status <> 'active' and not p_force then
    raise exception 'draft is % - only a forced (commissioner) pick is allowed', v_draft.status;
  end if;

  select team_count into v_count from leagues where id = v_draft.league_id;
  v_total   := v_count * v_draft.rounds;
  v_onclock := ff_team_on_clock(p_draft_id);
  v_team    := coalesce(p_team_id, v_onclock);

  if not p_force and p_team_id is not null and p_team_id <> v_onclock then
    raise exception 'team % is not on the clock', p_team_id;
  end if;

  v_round := ff_round_for_pick(v_draft.current_pick, v_count);

  insert into draft_picks (draft_id, pick_number, round, team_id, player_id, is_autopick, made_by)
  values (p_draft_id, v_draft.current_pick, v_round, v_team, p_player_id, p_autopick, p_made_by)
  returning * into v_pick;

  update drafts
     set current_pick  = current_pick + 1,
         pick_deadline = case
                           when current_pick + 1 > v_total then null
                           when status = 'active' then now() + make_interval(secs => pick_seconds)
                           else null end,
         status        = case when current_pick + 1 > v_total then 'complete'::draft_status else status end,
         completed_at  = case when current_pick + 1 > v_total then now() else completed_at end
   where id = p_draft_id;

  return v_pick;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_norm_name(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select regexp_replace(
           regexp_replace(lower(coalesce(p,'')), '\s+(jr|sr|ii|iii|iv|v)\.?$', ''),
           '[^a-z]', '', 'g')
$function$
;

CREATE OR REPLACE FUNCTION public.ff_pause_draft(p_draft_id uuid)
 RETURNS drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);
  if v_draft.status <> 'active' then return v_draft; end if;
  update drafts set status='paused',
         remaining_ms = greatest(0, (extract(epoch from (pick_deadline - now())) * 1000)::int),
         pick_deadline = null
   where id = p_draft_id returning * into v_draft;
  return v_draft;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_pick_for_my_team(p_draft_id uuid, p_player_id uuid)
 RETURNS draft_picks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_team uuid; v_onclock uuid; v_league uuid;
begin
  select league_id into v_league from drafts where id = p_draft_id;
  if v_league is null then raise exception 'draft not found'; end if;

  v_onclock := ff_team_on_clock(p_draft_id);

  if auth.uid() is not null then
    select id into v_team from teams
     where league_id = v_league and owner_id = auth.uid();
    -- commissioner may pick for whoever is on the clock
    if v_team is null and exists (
      select 1 from leagues where id = v_league and commissioner_id = auth.uid()
    ) then
      v_team := v_onclock;
    end if;
    if v_team is null then raise exception 'you do not own a team in this league'; end if;
    if v_team <> v_onclock then raise exception 'not your pick'; end if;
  else
    v_team := v_onclock;
  end if;

  return ff_make_pick(p_draft_id, p_player_id, v_team, auth.uid(), false, false);
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_preview_scoring_change(p_league_id uuid, p_new_rules jsonb, p_from_week integer DEFAULT 1, p_season integer DEFAULT 2025)
 RETURNS TABLE(week integer, players_changed integer, biggest_mover text, biggest_delta numeric, avg_abs_delta numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (
    select sl.week,
           p.full_name,
           ff_score(sl.stats, p_new_rules)
             - ff_score(sl.stats, ff_rules_for_week(p_league_id, sl.week)) as delta
    from player_stat_lines sl
    join players p on p.id = sl.player_id
    where sl.season = p_season and sl.week >= p_from_week
  ), ranked as (
    select *, row_number() over (partition by week order by abs(delta) desc) rn from d
  )
  select week,
         count(*) filter (where abs(delta) > 0.001)::int,
         max(full_name) filter (where rn = 1),
         round(max(delta) filter (where rn = 1), 2),
         round(avg(abs(delta)), 3)
  from ranked group by week order by week
$function$
;

CREATE OR REPLACE FUNCTION public.ff_randomize_draft_order(p_league_id uuid)
 RETURNS SETOF teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform ff_assert_commissioner(p_league_id);
  if exists (select 1 from drafts d join draft_picks dp on dp.draft_id = d.id
             where d.league_id = p_league_id) then
    raise exception 'draft has already started';
  end if;
  with shuffled as (
    select id, row_number() over (order by md5(id::text || clock_timestamp()::text)) as slot
    from teams where league_id = p_league_id
  )
  update teams t set draft_slot = null from shuffled s where t.id = s.id;
  with shuffled as (
    select id, row_number() over (order by md5(id::text || clock_timestamp()::text)) as slot
    from teams where league_id = p_league_id
  )
  update teams t set draft_slot = s.slot from shuffled s where t.id = s.id;
  return query select * from teams where league_id = p_league_id order by draft_slot;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_recompute_week(p_league_id uuid, p_week integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int;
begin
  with pts as (
    select team_id, sum(points) as total from roster_points
    where league_id = p_league_id and week = p_week and slot <> 'BN'
    group by team_id
  )
  update matchups m
     set home_points = coalesce((select total from pts where team_id = m.home_team_id), 0),
         away_points = coalesce((select total from pts where team_id = m.away_team_id), 0)
   where m.league_id = p_league_id and m.week = p_week;
  get diagnostics v_n = row_count;
  return v_n;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_resume_draft(p_draft_id uuid)
 RETURNS drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);
  if v_draft.status not in ('paused','setup') then return v_draft; end if;
  update drafts set status='active', started_at = coalesce(started_at, now()),
         pick_deadline = now() + make_interval(
           secs => (coalesce(remaining_ms, pick_seconds * 1000)::double precision / 1000.0)),
         remaining_ms = null
   where id = p_draft_id returning * into v_draft;
  return v_draft;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_roster_needs(p_draft_id uuid, p_team_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_league uuid; v_slots jsonb; v_needs text[] := '{}';
  v_pos text; v_req int; v_have int; v_flex_req int; v_flex_have int;
  v_dedicated int; i int;
begin
  select d.league_id into v_league from drafts d where d.id = p_draft_id;
  select roster_slots into v_slots from leagues where id = v_league;

  foreach v_pos in array array['QB','RB','WR','TE','K','DST'] loop
    select count(*) into v_req from jsonb_array_elements_text(v_slots) s where s = v_pos;
    select count(*) into v_have
      from draft_picks dp join players p on p.id = dp.player_id
     where dp.draft_id = p_draft_id and dp.team_id = p_team_id and p.position = v_pos;
    for i in 1..greatest(0, v_req - v_have) loop
      v_needs := array_append(v_needs, v_pos);
    end loop;
  end loop;

  select count(*) into v_flex_req from jsonb_array_elements_text(v_slots) s where s = 'FLEX';
  if v_flex_req > 0 then
    select count(*) into v_flex_have
      from draft_picks dp join players p on p.id = dp.player_id
     where dp.draft_id = p_draft_id and dp.team_id = p_team_id
       and p.position in ('RB','WR','TE');
    select count(*) into v_dedicated from jsonb_array_elements_text(v_slots) s
     where s in ('RB','WR','TE');
    for i in 1..greatest(0, v_flex_req - greatest(0, v_flex_have - v_dedicated)) loop
      v_needs := array_append(v_needs, 'FLEX'::text);
    end loop;
  end if;

  return v_needs;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_round_for_pick(p_pick integer, p_team_count integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select ((p_pick - 1) / p_team_count) + 1 $function$
;

CREATE OR REPLACE FUNCTION public.ff_rules_for_week(p_league_id uuid, p_week integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select rules from league_scoring_rules
  where league_id = p_league_id and effective_from_week <= p_week
  order by effective_from_week desc limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.ff_score(p_stats jsonb, p_rules jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v numeric := 0; v_pa numeric; fg_short numeric; v_dst_td numeric;
begin
  if p_stats is null or p_rules is null then return 0; end if;

  v := v
    + coalesce((p_stats->>'pass_yd')::numeric,0)   * coalesce((p_rules->>'pass_yd')::numeric,0)
    + coalesce((p_stats->>'pass_td')::numeric,0)   * coalesce((p_rules->>'pass_td')::numeric,0)
    + coalesce((p_stats->>'pass_int')::numeric,0)  * coalesce((p_rules->>'pass_int')::numeric,0)
    + coalesce((p_stats->>'pass_2pt')::numeric,0)  * coalesce((p_rules->>'pass_2pt')::numeric,0)
    + coalesce((p_stats->>'rush_yd')::numeric,0)   * coalesce((p_rules->>'rush_yd')::numeric,0)
    + coalesce((p_stats->>'rush_td')::numeric,0)   * coalesce((p_rules->>'rush_td')::numeric,0)
    + coalesce((p_stats->>'rush_2pt')::numeric,0)  * coalesce((p_rules->>'rush_2pt')::numeric,0)
    + coalesce((p_stats->>'rec')::numeric,0)       * coalesce((p_rules->>'rec')::numeric,0)
    + coalesce((p_stats->>'rec_yd')::numeric,0)    * coalesce((p_rules->>'rec_yd')::numeric,0)
    + coalesce((p_stats->>'rec_td')::numeric,0)    * coalesce((p_rules->>'rec_td')::numeric,0)
    + coalesce((p_stats->>'rec_2pt')::numeric,0)   * coalesce((p_rules->>'rec_2pt')::numeric,0)
    + coalesce((p_stats->>'fum_lost')::numeric,0)  * coalesce((p_rules->>'fum_lost')::numeric,0)
    + coalesce((p_stats->>'st_td')::numeric,0)     * coalesce((p_rules->>'st_td')::numeric,0)
    + coalesce((p_stats->>'st_fum_rec')::numeric,0)* coalesce((p_rules->>'st_fum_rec')::numeric,0);

  fg_short := greatest(0,
      coalesce((p_stats->>'fgm')::numeric,0)
    - coalesce((p_stats->>'fgm_40_49')::numeric,0)
    - coalesce((p_stats->>'fgm_50p')::numeric,0));
  v := v
    + fg_short                                     * coalesce((p_rules->>'fg_0_39')::numeric,0)
    + coalesce((p_stats->>'fgm_40_49')::numeric,0) * coalesce((p_rules->>'fg_40_49')::numeric,0)
    + coalesce((p_stats->>'fgm_50p')::numeric,0)   * coalesce((p_rules->>'fg_50_plus')::numeric,0)
    + coalesce((p_stats->>'fgmiss')::numeric,0)    * coalesce((p_rules->>'fg_miss')::numeric,0)
    + coalesce((p_stats->>'xpm')::numeric,0)       * coalesce((p_rules->>'xp_made')::numeric,0)
    + coalesce((p_stats->>'xpmiss')::numeric,0)    * coalesce((p_rules->>'xp_miss')::numeric,0);

  if p_stats ? 'pts_allow' then
    v_dst_td := coalesce(nullif(p_stats->>'def_st_td','')::numeric,
                         nullif(p_stats->>'def_td','')::numeric, 0)
              + coalesce(nullif(p_stats->>'fum_rec_ez_tds','')::numeric, 0);
    v := v
      + coalesce((p_stats->>'sack')::numeric,0)     * coalesce((p_rules->>'dst_sack')::numeric,0)
      + coalesce((p_stats->>'int')::numeric,0)      * coalesce((p_rules->>'dst_int')::numeric,0)
      + coalesce((p_stats->>'fum_rec')::numeric,0)  * coalesce((p_rules->>'dst_fum_rec')::numeric,0)
      + coalesce((p_stats->>'ff')::numeric,0)       * coalesce((p_rules->>'dst_forced_fumble')::numeric,0)
      + coalesce((p_stats->>'safe')::numeric,0)     * coalesce((p_rules->>'dst_safety')::numeric,0)
      + v_dst_td                                    * coalesce((p_rules->>'dst_td')::numeric,0)
      + coalesce((p_stats->>'blk_kick')::numeric,0) * coalesce((p_rules->>'dst_blocked_kick')::numeric,0);
    v_pa := coalesce((p_stats->>'pts_allow')::numeric, 0);
    v := v + case
      when v_pa = 0   then coalesce((p_rules->>'dst_pa_0')::numeric,0)
      when v_pa <= 6  then coalesce((p_rules->>'dst_pa_1_6')::numeric,0)
      when v_pa <= 13 then coalesce((p_rules->>'dst_pa_7_13')::numeric,0)
      when v_pa <= 20 then coalesce((p_rules->>'dst_pa_14_20')::numeric,0)
      when v_pa <= 27 then coalesce((p_rules->>'dst_pa_21_27')::numeric,0)
      when v_pa <= 34 then coalesce((p_rules->>'dst_pa_28_34')::numeric,0)
      else coalesce((p_rules->>'dst_pa_35_plus')::numeric,0)
    end;
  end if;

  return round(v, 2);
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_score_week(p_league_id uuid, p_week integer, p_stats jsonb)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ff_score(p_stats, ff_rules_for_week(p_league_id, p_week))
$function$
;

CREATE OR REPLACE FUNCTION public.ff_seed_rosters(p_league_id uuid, p_week integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_slots text[]; v_team record; v_slot text; v_pid uuid; v_draft uuid;
begin
  perform ff_assert_commissioner(p_league_id);
  select array(select jsonb_array_elements_text(roster_slots)) into v_slots
    from leagues where id = p_league_id;
  select id into v_draft from drafts where league_id = p_league_id;

  for v_team in select id from teams where league_id = p_league_id loop
    delete from rosters where team_id = v_team.id and week = p_week;

    foreach v_slot in array v_slots loop
      if v_slot = 'BN' then continue; end if;
      select p.id into v_pid
      from draft_picks dp
      join players p on p.id = dp.player_id
      left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format='ppr'
      where dp.draft_id = v_draft and dp.team_id = v_team.id
        and ff_slot_ok(v_slot, p.position)
        and not exists (select 1 from rosters r
                        where r.team_id = v_team.id and r.week = p_week and r.player_id = p.id)
      order by a.adp nulls last limit 1;

      if v_pid is not null then
        insert into rosters (team_id, player_id, week, slot, locked_at)
        values (v_team.id, v_pid, p_week, v_slot, ff_lock_time(v_pid, p_week));
      end if;
    end loop;

    insert into rosters (team_id, player_id, week, slot, locked_at)
    select v_team.id, dp.player_id, p_week, 'BN', ff_lock_time(dp.player_id, p_week)
    from draft_picks dp
    where dp.draft_id = v_draft and dp.team_id = v_team.id
      and not exists (select 1 from rosters r
                      where r.team_id = v_team.id and r.week = p_week and r.player_id = dp.player_id);
  end loop;

  return (select count(*) from rosters r join teams t on t.id = r.team_id
          where t.league_id = p_league_id and r.week = p_week);
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_set_lineup(p_team_id uuid, p_week integer, p_assignments jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_league uuid; v_n int := 0; k text; v_slot text; v_pid uuid; v_pos text; v_lock timestamptz;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  if auth.uid() is not null and not exists (
    select 1 from teams t join leagues l on l.id = t.league_id
    where t.id = p_team_id and (t.owner_id = auth.uid() or l.commissioner_id = auth.uid())
  ) then raise exception 'not your team'; end if;

  for k in select jsonb_object_keys(p_assignments) loop
    v_pid  := k::uuid;
    v_slot := p_assignments->>k;
    select position into v_pos from players where id = v_pid;
    if not ff_slot_ok(v_slot, v_pos) then
      raise exception '% cannot play in the % slot', v_pos, v_slot;
    end if;
    select locked_at into v_lock from rosters
     where team_id = p_team_id and week = p_week and player_id = v_pid;
    if v_lock is not null and v_lock <= now() then
      raise exception 'that player is locked - his game has already kicked off';
    end if;
    update rosters set slot = v_slot
     where team_id = p_team_id and week = p_week and player_id = v_pid;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_set_queue(p_team_id uuid, p_player_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int;
begin
  if auth.uid() is not null and not exists (
    select 1 from teams t join leagues l on l.id = t.league_id
    where t.id = p_team_id and (t.owner_id = auth.uid() or l.commissioner_id = auth.uid())
  ) then
    raise exception 'not your team';
  end if;

  delete from draft_queue where team_id = p_team_id;
  insert into draft_queue (team_id, player_id, rank)
  select p_team_id, pid, ord from unnest(p_player_ids) with ordinality as t(pid, ord);
  get diagnostics v_n = row_count;
  return v_n;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_set_scoring_rules(p_league_id uuid, p_rules jsonb, p_effective_from_week integer DEFAULT 1, p_note text DEFAULT NULL::text)
 RETURNS league_scoring_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row league_scoring_rules%rowtype;
begin
  perform ff_assert_commissioner(p_league_id);
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'rules must be a JSON object';
  end if;

  insert into league_scoring_rules (league_id, effective_from_week, rules, note, created_by)
  values (p_league_id, p_effective_from_week, p_rules, p_note, auth.uid())
  on conflict (league_id, effective_from_week) do update
    set rules = excluded.rules, note = excluded.note,
        created_by = excluded.created_by, created_at = now()
  returning * into v_row;

  -- keep the convenience mirror pointing at the latest ruleset
  update leagues set scoring_rules = (
    select rules from league_scoring_rules
    where league_id = p_league_id order by effective_from_week desc limit 1
  ) where id = p_league_id;

  return v_row;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_sleeper_default_rules()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select jsonb_build_object(
    'pass_yd', 0.04, 'pass_td', 4, 'pass_int', -1, 'pass_2pt', 2,
    'rush_yd', 0.1,  'rush_td', 6, 'rush_2pt', 2,
    'rec', 1.0,      'rec_yd', 0.1, 'rec_td', 6, 'rec_2pt', 2,
    'fum_lost', -2,  'st_td', 6, 'st_fum_rec', 1,
    'xp_made', 1, 'xp_miss', -1, 'fg_miss', -1,
    'fg_0_39', 3, 'fg_40_49', 4, 'fg_50_plus', 5,
    'dst_sack', 1, 'dst_int', 2, 'dst_fum_rec', 2, 'dst_safety', 2,
    'dst_td', 6, 'dst_blocked_kick', 2,
    'dst_pa_0', 10, 'dst_pa_1_6', 7, 'dst_pa_7_13', 4, 'dst_pa_14_20', 1,
    'dst_pa_21_27', 0, 'dst_pa_28_34', -1, 'dst_pa_35_plus', -4
  )
$function$
;

CREATE OR REPLACE FUNCTION public.ff_slot_ok(p_slot text, p_position text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_slot = 'BN'   then true
    when p_slot = 'FLEX' then p_position in ('RB','WR','TE')
    else p_slot = p_position
  end
$function$
;

CREATE OR REPLACE FUNCTION public.ff_snake_slot(p_pick integer, p_team_count integer)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare v_round int; v_idx int;
begin
  v_round := ((p_pick - 1) / p_team_count) + 1;
  v_idx   := p_pick - (v_round - 1) * p_team_count;
  if v_round % 2 = 0 then
    return p_team_count - v_idx + 1;
  end if;
  return v_idx;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_start_draft(p_draft_id uuid)
 RETURNS drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);
  update drafts set status='active', started_at = coalesce(started_at, now()),
         pick_deadline = now() + make_interval(secs => pick_seconds), remaining_ms = null
   where id = p_draft_id returning * into v_draft;
  return v_draft;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_team_on_clock(p_draft_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_league uuid; v_count int; v_pick int; v_slot int; v_team uuid;
begin
  select d.league_id, d.current_pick, l.team_count
    into v_league, v_pick, v_count
  from drafts d join leagues l on l.id = d.league_id
  where d.id = p_draft_id;
  if v_league is null then raise exception 'draft % not found', p_draft_id; end if;
  v_slot := ff_snake_slot(v_pick, v_count);
  select id into v_team from teams where league_id = v_league and draft_slot = v_slot;
  return v_team;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_tick_drafts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_draft record; v_made int := 0; v_guard int := 0;
begin
  for v_draft in
    select id from drafts
    where status = 'active' and pick_deadline is not null and pick_deadline < now()
  loop
    v_guard := 0;
    while v_guard < 50 loop
      begin
        perform ff_autopick(v_draft.id);
        v_made := v_made + 1;
      exception when others then
        insert into ingest_log (source, event, detail)
        values ('draft','autopick_failed',
                jsonb_build_object('draft', v_draft.id, 'error', sqlerrm));
        exit;
      end;
      v_guard := v_guard + 1;
      exit when not exists (
        select 1 from drafts
        where id = v_draft.id and status = 'active'
          and pick_deadline is not null and pick_deadline < now());
    end loop;
  end loop;

  if v_made > 0 then
    insert into ingest_log (source, event, detail)
    values ('draft','autopicked', jsonb_build_object('picks', v_made));
  end if;
  return v_made;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_undo_last_pick(p_draft_id uuid)
 RETURNS draft_picks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_draft drafts%rowtype; v_pick draft_picks%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);
  select * into v_pick from draft_picks where draft_id = p_draft_id order by pick_number desc limit 1;
  if not found then raise exception 'no picks to undo'; end if;
  delete from draft_picks where id = v_pick.id;
  update drafts set current_pick = v_pick.pick_number,
         status = case when status='complete' then 'paused'::draft_status else status end,
         completed_at = null,
         pick_deadline = case when status='active' then now() + make_interval(secs => pick_seconds) else null end
   where id = p_draft_id;
  return v_pick;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_update_draft(p_draft_id uuid, p_rounds integer DEFAULT NULL::integer, p_pick_seconds integer DEFAULT NULL::integer)
 RETURNS drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v drafts%rowtype; v_league uuid;
begin
  select league_id into v_league from drafts where id = p_draft_id;
  if v_league is null then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_league);
  if exists (select 1 from draft_picks where draft_id = p_draft_id) and p_rounds is not null then
    raise exception 'cannot change round count once picks have been made';
  end if;
  update drafts set rounds = coalesce(p_rounds, rounds),
                    pick_seconds = coalesce(p_pick_seconds, pick_seconds)
  where id = p_draft_id returning * into v;
  return v;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_update_league(p_league_id uuid, p_name text DEFAULT NULL::text, p_roster_slots jsonb DEFAULT NULL::jsonb, p_settings jsonb DEFAULT NULL::jsonb)
 RETURNS leagues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v leagues%rowtype;
begin
  perform ff_assert_commissioner(p_league_id);
  update leagues set
    name         = coalesce(p_name, name),
    roster_slots = coalesce(p_roster_slots, roster_slots),
    settings     = case when p_settings is null then settings else settings || p_settings end
  where id = p_league_id returning * into v;
  if not found then raise exception 'league % not found', p_league_id; end if;
  return v;
end; $function$
;

CREATE OR REPLACE FUNCTION public.ff_update_team(p_team_id uuid, p_name text DEFAULT NULL::text, p_draft_slot integer DEFAULT NULL::integer)
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v teams%rowtype; v_league uuid;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team % not found', p_team_id; end if;
  perform ff_assert_commissioner(v_league);

  -- draft slots are unique per league; swap rather than collide
  if p_draft_slot is not null then
    update teams set draft_slot = (select draft_slot from teams where id = p_team_id)
     where league_id = v_league and draft_slot = p_draft_slot and id <> p_team_id;
  end if;

  update teams set name = coalesce(p_name, name),
                   draft_slot = coalesce(p_draft_slot, draft_slot)
  where id = p_team_id returning * into v;
  return v;
end; $function$
;
