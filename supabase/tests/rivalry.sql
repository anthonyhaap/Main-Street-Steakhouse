-- ============================================================================
-- The rivalry card: one pairing, counted the same way the grid counts it.
--
-- The card and the history wall must never disagree, because they are the same
-- claim rendered twice and a league will notice. So this builds a history with
-- a known answer and checks both the totals and the things a card says that a
-- grid cannot: who is on a run, how long it is, and which game everybody
-- remembers.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_uid uuid; v_team uuid; v_bo uuid; v_match uuid;
  v_j jsonb; v_card jsonb; v_cell jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('riv@example.test') returning id into v_uid;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Rivalry Test', 2026, v_uid, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Alpha', 'Ada', v_uid) returning id into v_team;

  -- Seven meetings across three seasons, written straight into league_history
  -- so ff_all_games sees them as played. Ada leads 4-2-1, and the last three
  -- are hers, so the streak is three and not four.
  insert into league_history
    (league_id, season, week, round, home_manager, away_manager, home_team, away_team,
     home_points, away_points)
  values
    (v_league, 2023, 3,  'regular', 'Ada', 'Bo', 'Alpha', 'Bravo', 100, 130),   -- Bo
    (v_league, 2023, 9,  'regular', 'Bo', 'Ada', 'Bravo', 'Alpha', 88,  90),    -- Ada
    (v_league, 2024, 5,  'regular', 'Ada', 'Bo', 'Alpha', 'Bravo', 110, 110),   -- tie
    (v_league, 2024, 11, 'regular', 'Bo', 'Ada', 'Bravo', 'Alpha', 140, 60),    -- Bo, by 80
    (v_league, 2025, 2,  'regular', 'Ada', 'Bo', 'Alpha', 'Bravo', 120, 101),   -- Ada
    (v_league, 2025, 8,  'regular', 'Bo', 'Ada', 'Bravo', 'Alpha', 95,  99),    -- Ada
    (v_league, 2025, 15, 'final',   'Ada', 'Bo', 'Alpha', 'Bravo', 133, 120);   -- Ada, playoff

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  -- ------------------------------------------------------------ the totals --
  v_j := ff_rivalry(v_league, 'Ada', 'Bo');
  if (v_j->>'games')::int  <> 7 then raise exception 'counted % meetings, expected 7', v_j->>'games'; end if;
  if (v_j->>'a_wins')::int <> 4 then raise exception 'Ada has % wins, expected 4', v_j->>'a_wins'; end if;
  if (v_j->>'b_wins')::int <> 2 then raise exception 'Bo has % wins, expected 2', v_j->>'b_wins'; end if;
  if (v_j->>'ties')::int   <> 1 then raise exception 'counted % ties, expected 1', v_j->>'ties'; end if;
  if (v_j->>'playoff_games')::int <> 1 then raise exception 'counted % playoff meetings', v_j->>'playoff_games'; end if;
  if (v_j->>'first_season')::int <> 2023 then raise exception 'the rivalry started in %', v_j->>'first_season'; end if;
  v_checks := v_checks + 6;

  -- ------------------------------------------------------------ the streak --
  if v_j->>'streak_holder' <> 'Ada' then
    raise exception 'the streak belongs to %', v_j->>'streak_holder';
  end if;
  if (v_j->>'streak')::int <> 3 then
    raise exception 'the streak is %, expected 3 — a tie must end a run rather than extend it', v_j->>'streak';
  end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------------- the one they remember --
  -- 140-60 in 2024, not the most recent and not the closest.
  if (v_j->'biggest'->>'margin')::numeric <> 80 then
    raise exception 'the biggest margin was %', v_j->'biggest'->>'margin';
  end if;
  if v_j->'biggest'->>'winner' <> 'Bo' then
    raise exception 'the biggest win went to %', v_j->'biggest'->>'winner';
  end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------------------- the last meeting --
  if (v_j->'last'->>'season')::int <> 2025 or (v_j->'last'->>'week')::int <> 15 then
    raise exception 'the last meeting was reported as % week %',
      v_j->'last'->>'season', v_j->'last'->>'week';
  end if;
  if v_j->'last'->>'winner' <> 'Ada' then raise exception 'the last meeting went to %', v_j->'last'->>'winner'; end if;
  -- Points are from A's side whichever way round the fixture was played, so a
  -- caller never has to work out which column he was in.
  if (v_j->'last'->>'a_points')::numeric <> 133 then
    raise exception 'A''s points in the last meeting came back as %', v_j->'last'->>'a_points';
  end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------ read the other way --
  -- The same rivalry asked backwards is the same rivalry, mirrored.
  v_j := ff_rivalry(v_league, 'Bo', 'Ada');
  if (v_j->>'a_wins')::int <> 2 or (v_j->>'b_wins')::int <> 4 then
    raise exception 'asking backwards gave %-%', v_j->>'a_wins', v_j->>'b_wins';
  end if;
  if v_j->>'streak_holder' <> 'Ada' then
    raise exception 'the streak changed hands when the question was reversed';
  end if;
  if (v_j->'last'->>'a_points')::numeric <> 120 then
    raise exception 'reversing did not swap the points: %', v_j->'last'->>'a_points';
  end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------- the card and the wall --
  -- The wall's grid and this card are the same claim rendered twice. If they
  -- ever disagree a league notices, so they are checked against each other
  -- rather than each being checked against the same constants I typed above:
  -- comparing both to 4-2-1 would still pass on the day one of them stops
  -- reading ff_all_games and the other does not.
  v_card := ff_rivalry(v_league, 'Ada', 'Bo');
  select g into v_cell
    from jsonb_array_elements(ff_history(v_league)->'grid') g
   where g->>'manager' = 'Ada' and g->>'opponent' = 'Bo';
  if v_cell is null then
    raise exception 'the history grid has no cell for Ada v Bo at all';
  end if;
  if (v_cell->>'wins')::int   <> (v_card->>'a_wins')::int
  or (v_cell->>'losses')::int <> (v_card->>'b_wins')::int
  or (v_cell->>'ties')::int   <> (v_card->>'ties')::int then
    raise exception 'the grid says %-%-% and the card says %-%-%',
      v_cell->>'wins', v_cell->>'losses', v_cell->>'ties',
      v_card->>'a_wins', v_card->>'b_wins', v_card->>'ties';
  end if;
  v_checks := v_checks + 2;

  -- ---------------------------------------------------------- the emptiness --
  -- Two managers who have never met is a real answer, not an error: the card
  -- has to render something on the first week of a new manager's first season.
  v_j := ff_rivalry(v_league, 'Ada', 'Never Played');
  if (v_j->>'games')::int <> 0 then raise exception 'invented a meeting'; end if;
  if v_j->'last' <> 'null'::jsonb then raise exception 'invented a last meeting'; end if;
  if v_j->>'streak_holder' is not null then raise exception 'invented a streak'; end if;
  v_checks := v_checks + 3;

  -- A manager against himself is not a rivalry.
  if ff_rivalry(v_league, 'Ada', 'Ada') is not null then
    raise exception 'a manager has a rivalry with himself';
  end if;
  v_checks := v_checks + 1;

  -- Whitespace is not a manager.
  if ff_rivalry(v_league, 'Ada', '   ') is not null then
    raise exception 'blank was treated as a manager';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- a week's board --
  -- The scoreboard asks once for the whole week. What comes back has to be
  -- keyed by matchup id and oriented the way the board draws it: home first.
  insert into teams (league_id, name, manager_name) values (v_league, 'Bravo', 'Bo')
    returning id into v_bo;
  insert into matchups (league_id, week, home_team_id, away_team_id)
  values (v_league, 1, v_team, v_bo) returning id into v_match;

  v_j := ff_rivalries_for_week(v_league, 1);
  if v_j->(v_match::text) is null then
    raise exception 'the week came back without its only matchup';
  end if;
  if (v_j->(v_match::text)->>'a') <> 'Ada' or (v_j->(v_match::text)->>'b') <> 'Bo' then
    raise exception 'the card was not oriented home-first: % v %',
      v_j->(v_match::text)->>'a', v_j->(v_match::text)->>'b';
  end if;
  -- The same seven meetings, counted by the same function, reached the other
  -- way round. A board that quietly disagreed with the card would be worse
  -- than one that showed nothing.
  if (v_j->(v_match::text)->>'a_wins')::int <> 4 then
    raise exception 'the board says Ada has % wins', v_j->(v_match::text)->>'a_wins';
  end if;
  -- A week nobody plays is an empty object, not an error and not a null.
  if ff_rivalries_for_week(v_league, 9) <> '{}'::jsonb then
    raise exception 'an unplayed week invented matchups';
  end if;
  v_checks := v_checks + 4;

  -- ---------------------------------------------------------- who may read --
  perform set_config('request.jwt.claims', null, true);
  begin
    perform ff_rivalry(v_league, 'Ada', 'Bo');
    raise exception 'a signed-out request read the rivalry';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a signed-out request read the rivalry' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.ff_rivalry(uuid,text,text)', 'execute') then
    raise exception 'anon can read rivalries';
  end if;
  if has_function_privilege('anon', 'public.ff_rivalries_for_week(uuid,integer)', 'execute') then
    raise exception 'anon can read a whole week of rivalries';
  end if;
  v_checks := v_checks + 3;

  raise notice 'rivalry: % checks passed', v_checks;
end $$;

rollback;
