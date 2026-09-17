-- ============================================================================
-- The scoreboard has no score.
--
-- nfl_games has carried kickoff, state and status_detail since the first
-- migration, and never the score. Fantasy scoring never needed it — that comes
-- from player stat lines — so nothing asked. Pick'em asks: grading a
-- straight-up pick needs to know who won, and "who won" is not in status_detail
-- ("Final") in any form a query can compare.
--
-- ESPN already sends it. The scoreboard payload ff_load_nfl_week reads for
-- kickoff/state carries each competitor's `score` in the same object; this
-- adds the two columns and one more field to the same upsert, not a second
-- request or a second job.
--
-- The winner is not stored. It is `home_score`/`away_score` compared at read
-- time — one fewer thing that can drift from the two numbers it is made of,
-- and a game that finishes tied (rare, not impossible) resolves to no winner
-- rather than a wrong one.
-- ============================================================================

alter table public.nfl_games
  add column if not exists home_score integer,
  add column if not exists away_score integer;

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
                         kickoff_at, status, status_detail, home_score, away_score, updated_at)
  select e->>'id', p_season, 2, p_week,
         ht.abbr, at.abbr,
         (e->>'date')::timestamptz,
         e->'competitions'->0->'status'->'type'->>'state',
         e->'competitions'->0->'status'->'type'->>'shortDetail',
         (select c->>'score' from jsonb_array_elements(e->'competitions'->0->'competitors') c
           where c->>'homeAway' = 'home')::integer,
         (select c->>'score' from jsonb_array_elements(e->'competitions'->0->'competitors') c
           where c->>'homeAway' = 'away')::integer,
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
        status_detail = excluded.status_detail, home_score = excluded.home_score,
        away_score = excluded.away_score, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.ff_load_nfl_week(integer, integer) from public, anon, authenticated;

comment on function public.ff_load_nfl_week(integer, integer) is
  'Service only. Upserts one NFL week from the ESPN scoreboard: kickoff, state (pre/in/post), detail and each side''s score. The live poll and the nightly settle call it; ff_load_nfl_schedule loops it.';
