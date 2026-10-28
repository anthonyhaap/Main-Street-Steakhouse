-- ============================================================================
-- Steakhouse Sunday: the ball, and one call for the game center.
--
-- /sunday is the scoreboard read as a broadcast: every table at once, the NFL
-- slate beside it, and the players of OURS whose club is inside the twenty
-- right now. Two things it needs that the database does not yet have.
--
-- WHO HAS THE BALL. ESPN's scoreboard payload — the one ff_load_nfl_week
-- already reads every two minutes during a game window — carries a
-- `situation` on every competition in progress: which club has possession,
-- the down and distance, and `isRedZone`. Three more fields off the same
-- object, in the same upsert. No second request, no second job, and nobody's
-- browser talking to ESPN.
--
--   possession     our abbreviation for the club with the ball. ESPN names it
--                  by its own numeric team id, so it is resolved through the
--                  competitor carrying that id and then through nfl_teams, the
--                  same road home_team and away_team take.
--   red_zone       ESPN's own flag. False, not null, whenever there is no
--                  situation — a game not on has nobody in the red zone.
--   down_distance  ESPN's words: "1st & Goal at MIA 8".
--
-- All three are cleared when a game is not in progress, so a final never
-- shows a team still driving.
--
-- ONE CALL. ff_sunday(league, week) is ff_scoreboard with the week's NFL games
-- beside it. It calls ff_scoreboard rather than restating it — that function
-- is four hundred lines and the source of truth for every number on the
-- board, and a second copy of it is how the two would start to disagree. The
-- membership guard is therefore ff_scoreboard's own, and it runs first.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

alter table public.nfl_games
  add column if not exists possession text references public.nfl_teams(id),
  add column if not exists red_zone boolean not null default false,
  add column if not exists down_distance text;

comment on column public.nfl_games.possession is
  'Our abbreviation for the club with the ball, from ESPN''s situation. Null unless the game is in progress.';
comment on column public.nfl_games.red_zone is
  'ESPN''s isRedZone for the drive in progress. False whenever the game is not on.';
comment on column public.nfl_games.down_distance is
  'ESPN''s downDistanceText, e.g. "1st & Goal at MIA 8". Null unless the game is in progress.';

-- The same body as 20260924182613 with the situation added to the one upsert.
create or replace function public.ff_load_nfl_week(p_season integer, p_week integer)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_body text; v_n integer := 0;
begin
  select content into v_body from extensions.http_get(format(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=%s&seasontype=2&week=%s',
    p_season, p_week));
  if v_body is null then return 0; end if;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail, home_score, away_score, home_spread,
                         possession, red_zone, down_distance, updated_at)
  select e->>'id', p_season, 2, p_week,
         ht.abbr, at.abbr,
         (e->>'date')::timestamptz,
         e->'competitions'->0->'status'->'type'->>'state',
         e->'competitions'->0->'status'->'type'->>'shortDetail',
         (select c->>'score' from jsonb_array_elements(e->'competitions'->0->'competitors') c
           where c->>'homeAway' = 'home')::integer,
         (select c->>'score' from jsonb_array_elements(e->'competitions'->0->'competitors') c
           where c->>'homeAway' = 'away')::integer,
         public.ff_espn_home_spread(e->'competitions'->0),
         case when e->'competitions'->0->'status'->'type'->>'state' = 'in' then pos.abbr end,
         coalesce(e->'competitions'->0->'status'->'type'->>'state' = 'in'
                  and (e->'competitions'->0->'situation'->>'isRedZone')::boolean, false),
         case when e->'competitions'->0->'status'->'type'->>'state' = 'in'
              then nullif(btrim(e->'competitions'->0->'situation'->>'downDistanceText'), '') end,
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
  -- ESPN's `possession` is its numeric team id, which is also the
  -- competitor's `id`. A left join: no situation is the normal case.
  left join lateral (
    select t.id as abbr from nfl_teams t
    where coalesce(t.espn_id, t.id) = (
      select c->'team'->>'abbreviation' from jsonb_array_elements(e->'competitions'->0->'competitors') c
      where c->>'id' = e->'competitions'->0->'situation'->>'possession'
         or c->'team'->>'id' = e->'competitions'->0->'situation'->>'possession'
      limit 1)) pos on true
  on conflict (espn_event_id) do update
    set kickoff_at = excluded.kickoff_at, status = excluded.status,
        status_detail = excluded.status_detail, home_score = excluded.home_score,
        away_score = excluded.away_score,
        -- Moves while the game is ahead. Once ESPN says it is on, what ESPN
        -- sends is a live line, so the closing line stays.
        home_spread = case when excluded.status = 'pre'
                           then coalesce(excluded.home_spread, nfl_games.home_spread)
                           else coalesce(nfl_games.home_spread, excluded.home_spread) end,
        possession = excluded.possession,
        red_zone = excluded.red_zone,
        down_distance = excluded.down_distance,
        updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.ff_load_nfl_week(integer, integer) from public, anon, authenticated;

-- ------------------------------------------------------------ the center --

create or replace function public.ff_sunday(p_league_id uuid, p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_board  jsonb;
  v_season integer;
  v_week   integer;
  v_nfl    jsonb;
begin
  -- The guard: sign-in, league, membership. It raises before anything below
  -- is read, so this function can never show more than the board would.
  v_board := public.ff_scoreboard(p_league_id, p_week);

  v_season := (v_board->'league'->>'season')::integer;
  v_week   := (v_board->>'week')::integer;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id,
           'home', g.home_team,
           'away', g.away_team,
           'home_score', g.home_score,
           'away_score', g.away_score,
           'kickoff_at', g.kickoff_at,
           'status', g.status,
           'detail', g.status_detail,
           'home_spread', g.home_spread,
           'possession', g.possession,
           'red_zone', g.red_zone,
           'down_distance', g.down_distance,
           'updated_at', g.updated_at
         ) order by g.kickoff_at nulls last, g.home_team), '[]'::jsonb)
    into v_nfl
    from nfl_games g
   where g.season = v_season and g.season_type = 2 and g.week = v_week;

  return v_board || jsonb_build_object('nfl', v_nfl);
end $fn$;

revoke all on function public.ff_sunday(uuid, integer) from public, anon;
grant execute on function public.ff_sunday(uuid, integer) to authenticated;

comment on function public.ff_sunday(uuid, integer) is
  'Steakhouse Sunday: ff_scoreboard for the week plus `nfl`, the week''s NFL games with score, state, possession and red zone. Members only, by way of ff_scoreboard''s own guard.';
