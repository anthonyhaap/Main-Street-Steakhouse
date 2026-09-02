-- ============================================================================
-- The commissioner's year-round desk.
--
-- Three things the league asked for once the season was actually underway:
--
--   1. A name on every team. `teams.owner_email` was doing double duty as the
--      invite address and the label under the team name, which meant every
--      screen in the league printed a dozen email addresses. The commissioner
--      now types the manager's actual name; the email stays where it belongs,
--      on the invite screen.
--
--   2. Playoff projections. `ff_playoff_outlook` hands the browser everything
--      a season simulation needs in one call: the standings, every matchup
--      with whether it has been played, and a projected points-per-game for
--      each team drawn from its current starters' season projections. The
--      simulation itself runs client-side; a few thousand seasons of twelve
--      teams is nothing for a phone and would be a waste of a database.
--
--   3. Rule changes mid-season. `ff_set_scoring_rules` already versions rules
--      by effective week and `roster_points` already prices every week with
--      the rules in force for it. What was missing is the last step: matchup
--      totals are only written by the live poll and the nightly settle, so a
--      rule change would not show in the standings until the next cron run.
--      `ff_rescore_weeks` closes that gap on demand.
-- ============================================================================

-- ------------------------------------------------------------ manager names --

alter table public.teams add column if not exists manager_name text;

comment on column public.teams.manager_name is
  'The person behind the team, as the commissioner typed it. Shown league-wide in place of the email, which stays on the invite screen.';

-- The old three-argument signature has to go: PostgREST resolves overloads by
-- parameter name, and two functions that both accept (p_team_id, p_name) are
-- an ambiguity error, not a fallback.
drop function if exists public.ff_update_team(uuid, text, integer);

create or replace function public.ff_update_team(
  p_team_id      uuid,
  p_name         text    default null,
  p_draft_slot   integer default null,
  p_manager_name text    default null
)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare v teams%rowtype; v_league uuid;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team % not found', p_team_id; end if;
  perform ff_assert_commissioner(v_league);

  if p_name is not null and length(trim(p_name)) = 0 then
    raise exception 'team name cannot be blank';
  end if;

  -- draft slots are unique per league; swap rather than collide
  if p_draft_slot is not null then
    update teams set draft_slot = (select draft_slot from teams where id = p_team_id)
     where league_id = v_league and draft_slot = p_draft_slot and id <> p_team_id;
  end if;

  -- null leaves the manager name alone; an empty string clears it.
  update teams
     set name         = coalesce(nullif(trim(p_name), ''), name),
         draft_slot   = coalesce(p_draft_slot, draft_slot),
         manager_name = case when p_manager_name is null then manager_name
                             else nullif(trim(p_manager_name), '') end
   where id = p_team_id
  returning * into v;
  return v;
end $$;

revoke all on function public.ff_update_team(uuid, text, integer, text) from public, anon;
grant execute on function public.ff_update_team(uuid, text, integer, text) to authenticated;

-- The standings carry the name too, so no screen has to join for it.
-- Restated in full; the only change is the trailing column.
create or replace view public.standings with (security_invoker = true) as
with results as (
  select m.league_id, m.week, m.home_team_id as team_id, m.home_points as pf, m.away_points as pa
    from matchups m
  union all
  select m.league_id, m.week, m.away_team_id, m.away_points, m.home_points
    from matchups m
)
select t.league_id,
       t.id as team_id,
       t.name,
       count(*) filter (where r.pf > r.pa and r.pf + r.pa > 0) as wins,
       count(*) filter (where r.pf < r.pa and r.pf + r.pa > 0) as losses,
       count(*) filter (where r.pf = r.pa and r.pf + r.pa > 0) as ties,
       round(coalesce(sum(r.pf), 0), 2) as points_for,
       round(coalesce(sum(r.pa), 0), 2) as points_against,
       t.manager_name
  from teams t
  left join results r on r.team_id = t.id
 group by t.league_id, t.id, t.name, t.manager_name;

-- ------------------------------------------------------- rescore on demand --

create or replace function public.ff_rescore_weeks(p_league_id uuid, p_from_week integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_week integer; w integer; v_n integer := 0;
begin
  perform ff_assert_commissioner(p_league_id);
  v_week := greatest(1, public.ff_current_week());
  for w in greatest(1, coalesce(p_from_week, 1))..v_week loop
    v_n := v_n + coalesce(public.ff_recompute_week(p_league_id, w), 0);
  end loop;
  return v_n;
end $$;

revoke all on function public.ff_rescore_weeks(uuid, integer) from public, anon;
grant execute on function public.ff_rescore_weeks(uuid, integer) to authenticated;

comment on function public.ff_rescore_weeks(uuid, integer) is
  'Commissioner only. Rewrites matchup totals from p_from_week to the current week with the rules now in force for each week. Run after ff_set_scoring_rules.';

-- --------------------------------------------------------- playoff outlook --

create or replace function public.ff_playoff_outlook(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_league   leagues%rowtype;
  v_uid      uuid := auth.uid();
  v_week     integer;
  v_left     integer;
  v_teams    jsonb;
  v_matchups jsonb;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if v_uid is not null
     and not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week := greatest(1, public.ff_current_week());
  -- Projection weeks from here to the end of the NFL regular season. A
  -- starter's remaining projection spread over these is his expected weekly
  -- output, byes included, which is exactly what a season simulation wants.
  v_left := greatest(1, 19 - v_week);

  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_teams
  from (
    select jsonb_build_object(
      'id',             t.id,
      'name',           t.name,
      'manager_name',   t.manager_name,
      'wins',           s.wins,
      'losses',         s.losses,
      'ties',           s.ties,
      'points_for',     s.points_for,
      'points_against', s.points_against,
      -- Every score this team has actually posted, for the variance.
      'scores', coalesce((
        select jsonb_agg(r.pf order by r.week)
          from (select m.week,
                       case when m.home_team_id = t.id then m.home_points else m.away_points end as pf
                  from matchups m
                 where m.league_id = p_league_id
                   and (m.home_team_id = t.id or m.away_team_id = t.id)
                   and m.home_points + m.away_points > 0) r), '[]'::jsonb),
      -- What the current starters are expected to score per week. Null until
      -- rosters exist for this week, which the browser treats as "use the
      -- league average".
      'proj_ppg', (
        select round(sum(sp.points_remaining) / v_left, 2)
          from rosters r
          join player_season_projections sp
            on sp.player_id = r.player_id and sp.season = v_league.season
         where r.team_id = t.id and r.week = v_week and r.slot <> 'BN')
    ) as x
    from teams t
    join standings s on s.team_id = t.id
    where t.league_id = p_league_id
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           m.id,
           'week',         m.week,
           'home_team_id', m.home_team_id,
           'away_team_id', m.away_team_id,
           'home_points',  m.home_points,
           'away_points',  m.away_points,
           -- Matches the standings view: a game counts once anyone has scored.
           'played',       m.home_points + m.away_points > 0
         ) order by m.week), '[]'::jsonb)
    into v_matchups
    from matchups m
   where m.league_id = p_league_id;

  return jsonb_build_object(
    'week',                 v_week,
    'regular_season_weeks', coalesce((v_league.settings->>'regular_season_weeks')::int, 14),
    'playoff_teams',        coalesce((v_league.settings->>'playoff_teams')::int, 6),
    'playoff_byes',         coalesce((v_league.settings->>'playoff_byes')::int, 0),
    'teams',                v_teams,
    'matchups',             v_matchups,
    'generated_at',         now()
  );
end $$;

revoke all on function public.ff_playoff_outlook(uuid) from public, anon;
grant execute on function public.ff_playoff_outlook(uuid) to authenticated;

comment on function public.ff_playoff_outlook(uuid) is
  'Members only. Standings, full schedule with played flags, and projected points per game for each team: the inputs to the playoff simulation on the standings page.';
