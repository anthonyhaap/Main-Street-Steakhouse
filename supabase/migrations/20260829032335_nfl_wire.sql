-- ============================================================================
-- The wire, moved into Postgres.
--
-- It shipped as a Next.js route that fetched ESPN per request. That was the
-- wrong shape for three reasons, and the third one is a bug:
--
--   1. The injury feed is ~9 MB. Parsing it in a serverless function, on every
--      cold instance, to answer twelve managers is work done twelve times for
--      one answer. `pg_cron` already runs the stats poller on a schedule; this
--      belongs next to it.
--
--   2. Once the wire is a table, it joins. An injury row can carry the
--      `players.id` it refers to, so "is one of *my* guys hurt" is a foreign
--      key rather than a string match done in the browser.
--
--   3. ESPN's injury records do not carry `athlete.id`. Nothing in the JSON
--      names it — the id exists only inside the headshot URL
--      (`.../full/4240573.png`) and the injury `$ref`. The route matched on an
--      id that was always null, so the one rule that mattered most — your own
--      starter is hurt — could never fire. It is dug out of the URL here.
--
-- Both feeds are public and unauthenticated. We store ids, headlines and links
-- and point at ESPN's own images and articles; nothing is mirrored.
-- ============================================================================

create table if not exists public.nfl_news (
  id            text primary key,
  headline      text not null,
  description   text,
  published_at  timestamptz,
  url           text,
  byline        text,
  image_url     text,
  image_alt     text,
  /** ESPN athlete ids the story is filed under: [{"id","name"}]. */
  athletes      jsonb not null default '[]'::jsonb,
  /** Our club abbreviations. */
  teams         text[] not null default '{}',
  fetched_at    timestamptz not null default now()
);

create index if not exists nfl_news_published_idx on public.nfl_news (published_at desc);

create table if not exists public.nfl_injuries (
  id              text primary key,
  espn_athlete_id text,
  /** Resolved through player_id_map where we know the man. */
  player_id       uuid references public.players(id) on delete set null,
  name            text not null,
  position        text,
  team            text,
  /** ESPN's wording: "Out", "Questionable", "Injured Reserve"… */
  status          text not null,
  /** Our coarse bucket, so styling and logic never parse prose. */
  severity        text not null,
  detail          text,
  location        text,
  comment         text,
  return_date     date,
  reported_at     timestamptz,
  fetched_at      timestamptz not null default now()
);

create index if not exists nfl_injuries_player_idx on public.nfl_injuries (player_id);
create index if not exists nfl_injuries_team_idx   on public.nfl_injuries (team, position);

alter table public.nfl_news     enable row level security;
alter table public.nfl_injuries enable row level security;

drop policy if exists nfl_news_read on public.nfl_news;
drop policy if exists nfl_injuries_read on public.nfl_injuries;

-- Members only. This is a private league's cache of someone else's feed, not a
-- public mirror of it — the same reason the route it replaces sat behind auth.
create policy nfl_news_read     on public.nfl_news     for select using (ff_is_member());
create policy nfl_injuries_read on public.nfl_injuries for select using (ff_is_member());

grant select on public.nfl_news, public.nfl_injuries to authenticated;

-- ----------------------------------------------------------------------------
-- helpers
-- ----------------------------------------------------------------------------

/** ESPN's abbreviation to ours: WSH is WAS, LA is the Rams. */
create or replace function public.ff_club(p_abbr text)
returns text language sql stable as $$
  select coalesce(
    (select t.id from nfl_teams t where upper(t.espn_id) = upper(btrim(p_abbr))),
    (select t.id from nfl_teams t where upper(t.id)      = upper(btrim(p_abbr))),
    case upper(btrim(p_abbr)) when 'LA' then 'LAR' when 'JAC' then 'JAX'
                              when 'OAK' then 'LV' when 'SD' then 'LAC' end
  )
$$;

/** One reading of ESPN's injury prose, so nothing downstream repeats it. */
create or replace function public.ff_injury_severity(p_status text)
returns text language sql immutable as $$
  select case
    when p_status is null then 'unknown'
    when p_status ~* 'injured reserve|physically unable|non.football|suspend' then 'out'
    when p_status ~* '^\s*out' then 'out'
    when p_status ~* 'doubtful' then 'doubtful'
    when p_status ~* 'questionable|day.to.day' then 'questionable'
    when p_status ~* 'probable|^\s*active' then 'probable'
    else 'unknown'
  end
$$;

-- ----------------------------------------------------------------------------
-- ff_load_espn_injuries — the league-wide report, as a table.
--
-- The feed is a complete snapshot, so this is a replace: rows that have
-- dropped off the report must stop existing, or a player stays questionable
-- here forever after he has been cleared.
-- ----------------------------------------------------------------------------

create or replace function public.ff_load_espn_injuries()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_body text; v_rows int; v_matched int;
begin
  select content into v_body from extensions.http_get(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
  if v_body is null or length(v_body) < 1000 then
    raise exception 'espn injuries returned % bytes', coalesce(length(v_body),0);
  end if;

  drop table if exists _inj;
  create temp table _inj on commit drop as
  with rec as (
    select n
    from jsonb_array_elements(v_body::jsonb -> 'injuries') grp,
         jsonb_array_elements(grp -> 'injuries') n
  )
  select
    n->>'id' as id,
    -- The id ESPN does not give us, recovered from the only two places it
    -- appears: the headshot filename, then the injury self-reference.
    coalesce(
      substring(n->'athlete'->'headshot'->>'href' from '/full/(\d+)\.png'),
      substring(n->'athlete'->'notes'->'items'->0->'injury'->>'$ref' from '/athletes/(\d+)/')
    ) as espn_athlete_id,
    coalesce(n->'athlete'->>'displayName', n->'athlete'->>'fullName') as name,
    n->'athlete'->'position'->>'abbreviation' as position,
    public.ff_club(n->'athlete'->'team'->>'abbreviation') as team,
    coalesce(nullif(n->>'status',''), n->'type'->>'description', 'Unknown') as status,
    nullif(n->'details'->>'type','')     as detail,
    nullif(n->'details'->>'location','') as location,
    nullif(coalesce(n->>'shortComment', n->>'longComment'), '') as comment,
    nullif(n->'details'->>'returnDate','')::date as return_date,
    nullif(n->>'date','')::timestamptz as reported_at
  from rec
  where n->'athlete'->>'displayName' is not null;

  delete from nfl_injuries where id not in (select id from _inj where id is not null);

  insert into nfl_injuries (id, espn_athlete_id, player_id, name, position, team,
                            status, severity, detail, location, comment,
                            return_date, reported_at, fetched_at)
  select i.id, i.espn_athlete_id, m.player_id, i.name, i.position, i.team,
         i.status, public.ff_injury_severity(i.status), i.detail, i.location,
         i.comment, i.return_date, i.reported_at, now()
  from _inj i
  left join player_id_map m on m.source = 'espn' and m.source_id = i.espn_athlete_id
  where i.id is not null
  on conflict (id) do update
    set espn_athlete_id = excluded.espn_athlete_id,
        player_id       = excluded.player_id,
        name            = excluded.name,
        position        = excluded.position,
        team            = excluded.team,
        status          = excluded.status,
        severity        = excluded.severity,
        detail          = excluded.detail,
        location        = excluded.location,
        comment         = excluded.comment,
        return_date     = excluded.return_date,
        reported_at     = excluded.reported_at,
        fetched_at      = now();

  select count(*), count(player_id) into v_rows, v_matched from nfl_injuries;

  insert into ingest_log (source, event, detail)
  values ('espn', 'injuries', jsonb_build_object('rows', v_rows, 'matched', v_matched));

  return jsonb_build_object('rows', v_rows, 'matched_to_players', v_matched);
end $$;

-- ----------------------------------------------------------------------------
-- ff_load_espn_news — headlines, photographs and who they are about.
--
-- The `categories` array is the reason this is worth storing rather than
-- rendering: ESPN files each story under the athletes and clubs it concerns,
-- which is what lets the app say "this is about *your* running back".
-- ----------------------------------------------------------------------------

create or replace function public.ff_load_espn_news(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_body text; v_rows int;
begin
  select content into v_body from extensions.http_get(format(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=%s', greatest(1, least(p_limit, 100))));
  if v_body is null or length(v_body) < 500 then
    raise exception 'espn news returned % bytes', coalesce(length(v_body),0);
  end if;

  with art as (
    select a from jsonb_array_elements(v_body::jsonb -> 'articles') a
    where a->>'headline' is not null
  ),
  shaped as (
    select
      coalesce(nullif(a->>'id',''), a->'links'->'web'->>'href', a->>'headline') as id,
      a->>'headline'    as headline,
      nullif(a->>'description','') as description,
      nullif(coalesce(a->>'published', a->>'lastModified'),'')::timestamptz as published_at,
      a->'links'->'web'->>'href' as url,
      nullif(a->>'byline','')    as byline,
      a->'images'->0->>'url'     as image_url,
      coalesce(a->'images'->0->>'caption', a->'images'->0->>'alt', a->>'headline') as image_alt,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', c->>'athleteId',
                                            'name', coalesce(c->'athlete'->>'description', c->>'description')))
        from jsonb_array_elements(a->'categories') c
        where c->>'type' = 'athlete' and c->>'athleteId' is not null
      ), '[]'::jsonb) as athletes,
      coalesce((
        select array_agg(distinct club)
        from jsonb_array_elements(a->'categories') c
        cross join lateral public.ff_club(c->'team'->>'abbreviation') club
        where c->>'type' = 'team' and club is not null
      ), '{}'::text[]) as teams
    from art
  )
  insert into nfl_news (id, headline, description, published_at, url, byline,
                        image_url, image_alt, athletes, teams, fetched_at)
  select id, headline, description, published_at, url, byline,
         image_url, image_alt, athletes, teams, now()
  from shaped
  on conflict (id) do update
    set headline     = excluded.headline,
        description  = excluded.description,
        published_at = excluded.published_at,
        url          = excluded.url,
        byline       = excluded.byline,
        image_url    = excluded.image_url,
        image_alt    = excluded.image_alt,
        athletes     = excluded.athletes,
        teams        = excluded.teams,
        fetched_at   = now();

  get diagnostics v_rows = row_count;

  -- Keep a fortnight. Older than that nobody scrolls to, and the feed is a
  -- window on the present, not an archive we promised anyone.
  delete from nfl_news where published_at < now() - interval '14 days';

  insert into ingest_log (source, event, detail)
  values ('espn', 'news', jsonb_build_object('rows', v_rows));

  return jsonb_build_object('rows', v_rows);
end $$;

-- ----------------------------------------------------------------------------
-- ff_refresh_wire — one call for the cron, and neither feed can sink the other.
-- ----------------------------------------------------------------------------

create or replace function public.ff_refresh_wire()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_news jsonb := null; v_inj jsonb := null; v_errs jsonb := '[]'::jsonb;
begin
  begin v_news := public.ff_load_espn_news(50);
  exception when others then
    v_errs := v_errs || jsonb_build_object('feed','news','error',sqlerrm);
    insert into ingest_log (source, event, detail)
    values ('espn','news_failed', jsonb_build_object('error', sqlerrm));
  end;

  begin v_inj := public.ff_load_espn_injuries();
  exception when others then
    v_errs := v_errs || jsonb_build_object('feed','injuries','error',sqlerrm);
    insert into ingest_log (source, event, detail)
    values ('espn','injuries_failed', jsonb_build_object('error', sqlerrm));
  end;

  return jsonb_build_object('news', v_news, 'injuries', v_inj, 'errors', v_errs);
end $$;

revoke all on function public.ff_load_espn_news(integer) from public;
revoke all on function public.ff_load_espn_injuries() from public;
revoke all on function public.ff_refresh_wire() from public;
