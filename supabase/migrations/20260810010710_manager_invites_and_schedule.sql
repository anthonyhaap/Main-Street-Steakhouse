-- ============ 1. Twelve managers ============
-- Invite by email up front; the account links itself on first login. This is
-- the failure mode that actually ruins draft night (ten people signing in for
-- the first time at 7pm), so it must need zero commissioner involvement.
alter table teams add column if not exists owner_email text;
create unique index if not exists teams_owner_email_idx
  on teams (league_id, lower(owner_email)) where owner_email is not null;

create or replace function ff_invite_manager(p_team_id uuid, p_email text)
returns teams language plpgsql security definer set search_path = public as $$
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
end; $$;

-- Called on every page load. Idempotent, cheap, and self-healing.
create or replace function ff_link_me()
returns teams language plpgsql security definer set search_path = public as $$
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
end; $$;

-- ============ 2. NFL schedule (kickoff times drive lineup lock) ============
create or replace function ff_load_nfl_schedule(p_season int default 2026, p_weeks int default 18)
returns int language plpgsql security definer set search_path = public, extensions as $$
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
end; $$;

-- ============ 3. Fantasy matchup schedule ============
-- Circle-method round robin over the regular season.
create or replace function ff_generate_schedule(p_league_id uuid)
returns int language plpgsql security definer set search_path = public as $$
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
end; $$;