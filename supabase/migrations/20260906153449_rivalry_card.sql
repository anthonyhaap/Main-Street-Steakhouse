-- ============================================================================
-- The rivalry, where it actually bites.
--
-- Most of this feature already existed and was in the wrong place. ff_history
-- computes an auto-detected rivalry score, and the history wall renders the top
-- few — its own comment quotes the line the feature exists for: "wait, I'm 2-11
-- against Mike?". But the only way to reach that line was to open History and
-- read a twelve-by-twelve grid, which is a thing you do once in August.
--
-- The moment it matters is the moment you are about to play him. So this is one
-- pairing, told as a story, for the screen where the two names are already next
-- to each other. Nothing here is a new fact — it is the same ff_all_games every
-- other history number comes from, so the card and the grid cannot disagree.
--
-- Manager names rather than team ids, deliberately. A club can be renamed, sold
-- or rebranded between seasons and the imported history is keyed by the person;
-- a rivalry is between two managers, and pretending it is between two brands
-- would break it the first time somebody renames his team.
-- ============================================================================

create or replace function public.ff_rivalry(
  p_league_id uuid,
  p_a         text,
  p_b         text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_a text := btrim(p_a);
  v_b text := btrim(p_b);
  v_out jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;
  if coalesce(v_a, '') = '' or coalesce(v_b, '') = '' or v_a = v_b then return null; end if;

  -- One query, no temp table: this function is STABLE, and a temp table would
  -- force it volatile — which would be a lie about a function that only reads,
  -- and would stop the planner inlining it where the feed calls it per row.
  with rv as (
    -- Every meeting, either way round, always from A's point of view so the
    -- caller never has to work out which column he was in.
    select g.season, g.week, g.round,
           case when g.home_manager = v_a then g.home_points else g.away_points end as a_points,
           case when g.home_manager = v_a then g.away_points else g.home_points end as b_points,
           case when g.home_points = g.away_points then null
                when g.home_points > g.away_points then g.home_manager
                else g.away_manager end as winner
      from public.ff_all_games(p_league_id) g
     where g.played
       and ((g.home_manager = v_a and g.away_manager = v_b)
         or (g.home_manager = v_b and g.away_manager = v_a))
  ),
  ordered as (
    select *, row_number() over (order by season desc, week desc) as rn from rv
  ),
  latest as (select * from ordered where rn = 1),
  -- The current run: rows back from the most recent until somebody else won,
  -- or until a tie. A tie ENDS a streak rather than extending it, because "won
  -- four straight" has to mean four.
  broke as (
    select min(rn) as rn from ordered
     where winner is distinct from (select winner from latest)
  ),
  streak as (
    select case when (select winner from latest) is null then null
                else (select winner from latest) end as holder,
           case when (select winner from latest) is null then 0
                else coalesce((select rn from broke) - 1, (select count(*)::int from ordered))
           end as n
  )
  select jsonb_build_object(
    'a', v_a, 'b', v_b,
    'games',  (select count(*) from rv),
    'a_wins', (select count(*) from rv where winner = v_a),
    'b_wins', (select count(*) from rv where winner = v_b),
    'ties',   (select count(*) from rv where winner is null),
    'playoff_games', (select count(*) from rv where round is distinct from 'regular'),
    'first_season',  (select min(season) from rv),
    'streak_holder', (select holder from streak),
    'streak',        (select n from streak),
    'last', (select jsonb_build_object(
               'season', season, 'week', week, 'round', round,
               'a_points', a_points, 'b_points', b_points, 'winner', winner)
               from latest),
    -- The one everybody remembers. A tie cannot be a biggest win, so ties are
    -- excluded rather than sorting in at a margin of zero.
    'biggest', (select jsonb_build_object(
                  'season', season, 'week', week, 'winner', winner,
                  'margin', round(abs(a_points - b_points), 1),
                  'a_points', a_points, 'b_points', b_points)
                  from rv where winner is not null
                 order by abs(a_points - b_points) desc, season desc limit 1))
    into v_out;

  return v_out;
end $$;

comment on function public.ff_rivalry(uuid, text, text) is
  'One pairing''s head-to-head story, from the same ff_all_games every other history number comes from. Keyed on manager names, because a rivalry survives a team being renamed.';

revoke execute on function public.ff_rivalry(uuid, text, text) from public, anon;
grant execute on function public.ff_rivalry(uuid, text, text) to authenticated, service_role;


-- ============================================================================
-- A whole week's worth, in one call.
--
-- The card belongs on the scoreboard, and the scoreboard polls every fifteen
-- seconds while football is on. Six cards fetching their own rivalry would be
-- six extra round trips per poll for numbers that only change when a game goes
-- final — so the week is answered once, by the server, which also spares the
-- client having to work out which two managers a matchup is between.
--
-- Keyed by matchup id rather than by name pair, because the caller has the
-- matchup in his hand and matching on names client-side is how a renamed team
-- silently loses its history.
-- ============================================================================

create or replace function public.ff_rivalries_for_week(
  p_league_id uuid,
  p_week      integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  -- Points inside each card are from the HOME manager's side, matching the
  -- order the scoreboard already draws the two names in.
  select coalesce(jsonb_object_agg(m.id::text, public.ff_rivalry(p_league_id, hm.who, am.who)), '{}'::jsonb)
    into v_out
    from matchups m
    join teams h on h.id = m.home_team_id
    join teams a on a.id = m.away_team_id
   cross join lateral (select coalesce(nullif(btrim(h.manager_name), ''), h.name) as who) hm
   cross join lateral (select coalesce(nullif(btrim(a.manager_name), ''), a.name) as who) am
   where m.league_id = p_league_id and m.week = p_week;

  return v_out;
end $$;

comment on function public.ff_rivalries_for_week(uuid, integer) is
  'Every rivalry on one week''s board, keyed by matchup id, so the scoreboard costs one round trip rather than one per card.';

revoke execute on function public.ff_rivalries_for_week(uuid, integer) from public, anon;
grant execute on function public.ff_rivalries_for_week(uuid, integer) to authenticated, service_role;
