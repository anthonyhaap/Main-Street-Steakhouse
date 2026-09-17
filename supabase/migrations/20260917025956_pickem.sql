-- ============================================================================
-- Pick'em: the whole house against the schedule, straight up.
--
-- No spreads, no confidence points, no money — one tap per game, the winner
-- you think takes it. The rules that make it worth doing every week rather
-- than a novelty in September:
--
-- ONE PICK PER GAME, CHANGEABLE. Same shape as a poll vote: the primary key
-- is really (game_id, user_id) — a unique constraint here, since the row also
-- needs its own id for the realtime feed — so picking again moves your pick
-- rather than adding a second one.
--
-- THE LOCK IS THE GAME'S OWN KICKOFF, NOT THE WEEK'S. Thursday Night Football
-- kicking off does not touch Sunday's picks. ff_make_pick checks the one game
-- being picked against nfl_games.kickoff_at, server-side — there is no column
-- here that says "locked", because the lock is a comparison against a
-- timestamp this table does not own, and a stored flag would be one more
-- place for that comparison to drift from the truth.
--
-- PICKS ARE HIDDEN UNTIL KICKOFF, THE SAME WAY A POLL'S SPLIT IS HIDDEN UNTIL
-- YOU VOTE. Seeing the house's picks before yours locks in is copying, not
-- playing — so the table's own RLS shows a manager only his own row, and
-- ff_pickem_week (the one place anyone reads another manager's pick) reveals
-- the field only for a game that has already kicked off.
--
-- NO STORED STANDINGS. Weekly and season records, rank, and the weekly
-- champion are computed from picks and nfl_games' scores every time they are
-- asked for. A dozen managers and at most sixteen games a week is nothing to
-- aggregate on the fly, and it means a corrected final score is never out of
-- step with a cached table somewhere that forgot to recompute.
--
-- Pick'em is per person, not per team — a co-owned team's two managers pick
-- separately, the way they do not share a single vote on a poll either — so
-- this hangs off auth.users and profiles.display_name, not teams.owner_id.
-- ============================================================================

create table public.pickem_picks (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues(id) on delete cascade,
  game_id       uuid not null references public.nfl_games(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  selected_team text not null references public.nfl_teams(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (game_id, user_id)
);
create index pickem_picks_league_game_idx on public.pickem_picks (league_id, game_id);
create index pickem_picks_user_idx on public.pickem_picks (user_id);

comment on table public.pickem_picks is
  'One row per manager per NFL game. Upserted on (game_id, user_id) — changing your mind before kickoff is an update, not a second pick. Never read directly for another manager''s row; see ff_pickem_week.';

alter table public.pickem_picks enable row level security;

-- Your own pick and nobody else's. ff_pickem_week is where every other
-- manager's pick comes from, and only for a game that has kicked off.
create policy pickem_picks_own on public.pickem_picks
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.pickem_picks from public, anon, authenticated;
grant select on table public.pickem_picks to authenticated;

do $$ begin alter publication supabase_realtime add table public.pickem_picks;
exception when duplicate_object then null; end $$;


-- ------------------------------------------------------------- who plays --

-- Everyone with a seat in the league — owner, co-owner, or commissioner —
-- with the name their pick should show. Plain SQL and not SECURITY DEFINER,
-- like ff_seat_team: it is only ever called from inside the SECURITY DEFINER
-- functions below, which already run as their owner.
create or replace function public.ff_pickem_members(p_league_id uuid)
returns table (user_id uuid, display_name text)
language sql
stable
set search_path = public
as $$
  select m.user_id,
         coalesce(
           (select p.display_name from profiles p where p.id = m.user_id),
           (select t.manager_name from teams t
             where t.league_id = p_league_id and t.owner_id = m.user_id),
           (select split_part(u.email, '@', 1) from auth.users u where u.id = m.user_id),
           'A manager')
    from (
      select owner_id as user_id from teams
       where league_id = p_league_id and owner_id is not null
      union
      select user_id from team_co_owners where league_id = p_league_id
      union
      select commissioner_id as user_id from leagues
       where id = p_league_id and commissioner_id is not null
    ) m
$$;

revoke execute on function public.ff_pickem_members(uuid) from public, anon, authenticated;
grant execute on function public.ff_pickem_members(uuid) to service_role;


-- ------------------------------------------------------------- picking one --

create or replace function public.ff_make_pick(p_league_id uuid, p_game_id uuid, p_team text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_game nfl_games%rowtype;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  select * into v_game from nfl_games where id = p_game_id;
  if not found then raise exception 'no such game'; end if;

  -- The lock, checked against the one timestamp that means anything: the
  -- game's own kickoff. A pending game with no kickoff yet loaded can't be
  -- picked either — there is nothing to lock it to.
  if v_game.kickoff_at is null or v_game.kickoff_at <= now() or v_game.status is distinct from 'pre' then
    raise exception 'that game has kicked off — the pick is locked';
  end if;

  if p_team not in (v_game.home_team, v_game.away_team) then
    raise exception 'that team is not in this matchup';
  end if;

  insert into pickem_picks (league_id, game_id, user_id, selected_team)
  values (p_league_id, p_game_id, v_uid, p_team)
  on conflict (game_id, user_id) do update
    set selected_team = excluded.selected_team, updated_at = now();

  return jsonb_build_object('game_id', p_game_id, 'selected_team', p_team);
end $$;

revoke execute on function public.ff_make_pick(uuid, uuid, text) from public, anon;
grant execute on function public.ff_make_pick(uuid, uuid, text) to authenticated, service_role;


-- -------------------------------------------------------------- the board --

-- Every game in the week, with the caller's own pick always attached and
-- everyone else's — plus the pick distribution — attached only once the game
-- has kicked off. Before that, `picks` and `distribution` are null rather
-- than empty: a reader should not be able to tell "hidden" from "nobody has
-- picked yet" apart, the same way a poll withholds its split rather than
-- showing zeroes.
create or replace function public.ff_pickem_week(p_league_id uuid, p_season integer, p_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_members integer;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  select count(*) into v_members from public.ff_pickem_members(p_league_id);

  return jsonb_build_object(
    'members', v_members,
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
               'game_id', g.id,
               'home_team', g.home_team,
               'away_team', g.away_team,
               'kickoff_at', g.kickoff_at,
               'status', g.status,
               'status_detail', g.status_detail,
               'home_score', g.home_score,
               'away_score', g.away_score,
               'locked', (g.kickoff_at <= now() or g.status is distinct from 'pre'),
               'winner', case when g.status = 'post'
                                and g.home_score is not null and g.away_score is not null
                              then case when g.home_score > g.away_score then g.home_team
                                        when g.away_score > g.home_score then g.away_team end
                         end,
               'my_pick', (select pp.selected_team from pickem_picks pp
                            where pp.game_id = g.id and pp.user_id = v_uid),
               'picks', case when g.kickoff_at <= now() or g.status is distinct from 'pre' then (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'user_id', m.user_id, 'display_name', m.display_name,
                            'selected_team', pp.selected_team) order by m.display_name),
                          '[]'::jsonb)
                     from public.ff_pickem_members(p_league_id) m
                     left join pickem_picks pp on pp.game_id = g.id and pp.user_id = m.user_id)
                 else null end,
               'distribution', case when g.kickoff_at <= now() or g.status is distinct from 'pre' then (
                   select coalesce(jsonb_object_agg(t.team, t.n), '{}'::jsonb)
                     from (select pp.selected_team as team, count(*) as n
                             from pickem_picks pp where pp.game_id = g.id
                            group by pp.selected_team) t)
                 else null end
             ) order by g.kickoff_at)
        from nfl_games g
       where g.season = p_season and g.season_type = 2 and g.week = p_week
    ), '[]'::jsonb));
end $$;

revoke execute on function public.ff_pickem_week(uuid, integer, integer) from public, anon;
grant execute on function public.ff_pickem_week(uuid, integer, integer) to authenticated, service_role;


-- --------------------------------------------------------- one week, graded --

-- Correct / incorrect / remaining for every member, for one week. The three
-- outcomes, per member per game:
--   the game is final and the pick matches the winner        -> correct
--   the game is final and the pick doesn't (or there is none) -> incorrect
--   the game has kicked off, final or not, and there is no pick -> incorrect
--     (the NO PICK rule bites at kickoff, not at final)
--   anything else (not yet kicked, or kicked but still live with a pick in) -> remaining
-- A final tied game (no winner) resolves to remaining for everyone — a push,
-- not a miss.
create or replace function public.ff_pickem_weekly_standings(p_league_id uuid, p_season integer, p_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  return coalesce((
    with games as (
      select g.id, g.status, g.kickoff_at,
             case when g.status = 'post' and g.home_score is not null and g.away_score is not null
                  then case when g.home_score > g.away_score then g.home_team
                            when g.away_score > g.home_score then g.away_team end
                  end as winner
        from nfl_games g
       where g.season = p_season and g.season_type = 2 and g.week = p_week
    ),
    graded as (
      select m.user_id, m.display_name,
             sum(case when games.winner is not null and pp.selected_team = games.winner
                      then 1 else 0 end) as correct,
             sum(case when (games.winner is not null and (pp.selected_team is null or pp.selected_team <> games.winner))
                        or (games.winner is null and games.status <> 'post'
                            and games.kickoff_at <= now() and pp.selected_team is null)
                      then 1 else 0 end) as incorrect
        from public.ff_pickem_members(p_league_id) m
        cross join games
        left join pickem_picks pp on pp.game_id = games.id and pp.user_id = m.user_id
       group by m.user_id, m.display_name
    ),
    ranked as (
      select *, (select count(*) from games) - (correct + incorrect) as remaining,
             rank() over (order by correct desc, incorrect asc, display_name asc) as rnk
        from graded
    )
    select jsonb_agg(jsonb_build_object(
             'user_id', user_id, 'display_name', display_name,
             'correct', correct, 'incorrect', incorrect, 'remaining', remaining,
             'win_pct', case when correct + incorrect = 0 then 0
                             else round(100.0 * correct / (correct + incorrect), 1) end,
             'mine', user_id = v_uid, 'rank', rnk
           ) order by rnk)
      from ranked
  ), '[]'::jsonb);
end $$;

revoke execute on function public.ff_pickem_weekly_standings(uuid, integer, integer) from public, anon;
grant execute on function public.ff_pickem_weekly_standings(uuid, integer, integer) to authenticated, service_role;


-- --------------------------------------------------------- the whole season --

-- Every week's standings, summed, plus how many weeks each member has
-- outright topped (ties share the win — a 13-3 week that two people share is
-- two weekly wins, not a coin flip). Built by calling ff_pickem_weekly_standings
-- once per week rather than re-deriving the per-game logic a second time —
-- the one true grading rule stays in one function.
create or replace function public.ff_pickem_season_standings(p_league_id uuid, p_season integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_last_week integer;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  select max(week) into v_last_week from nfl_games where season = p_season and season_type = 2;
  if v_last_week is null then return '[]'::jsonb; end if;

  return coalesce((
    with weekly as (
      select w.week,
             (s.value ->> 'user_id')::uuid as user_id,
             (s.value ->> 'correct')::int as correct,
             (s.value ->> 'incorrect')::int as incorrect
        from generate_series(1, v_last_week) as w(week)
        cross join lateral jsonb_array_elements(
          public.ff_pickem_weekly_standings(p_league_id, p_season, w.week)) as s(value)
    ),
    per_user as (
      select user_id, sum(correct) as correct, sum(incorrect) as incorrect
        from weekly
       group by user_id
    ),
    week_top as (
      select week, user_id
        from (select week, user_id, correct,
                     rank() over (partition by week order by correct desc) as r
                from weekly where correct > 0) x
       where r = 1
    ),
    wins as (
      select user_id, count(*) as weekly_wins from week_top group by user_id
    ),
    combined as (
      select m.user_id, m.display_name,
             coalesce(pu.correct, 0) as correct,
             coalesce(pu.incorrect, 0) as incorrect,
             coalesce(w.weekly_wins, 0) as weekly_wins
        from public.ff_pickem_members(p_league_id) m
        left join per_user pu on pu.user_id = m.user_id
        left join wins w on w.user_id = m.user_id
    ),
    ranked as (
      select *, correct + incorrect as total,
             rank() over (order by correct desc, incorrect asc, display_name asc) as rnk
        from combined
    )
    select jsonb_agg(jsonb_build_object(
             'user_id', user_id, 'display_name', display_name,
             'correct', correct, 'incorrect', incorrect, 'total', total,
             'win_pct', case when total = 0 then 0 else round(100.0 * correct / total, 1) end,
             'weekly_wins', weekly_wins, 'mine', user_id = v_uid, 'rank', rnk
           ) order by rnk)
      from ranked
  ), '[]'::jsonb);
end $$;

revoke execute on function public.ff_pickem_season_standings(uuid, integer) from public, anon;
grant execute on function public.ff_pickem_season_standings(uuid, integer) to authenticated, service_role;
