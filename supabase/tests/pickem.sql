-- ============================================================================
-- Pick'em: locked at the game's own kickoff, hidden until then, graded once
-- it's final — and person-based, so a co-owner's pick is his own.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_c uuid; v_uid_out uuid;
  v_g1 uuid; v_g2 uuid; v_g3 uuid;
  v_j jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('pka@example.test') returning id into v_uid_a;
  insert into auth.users (email) values ('pkb@example.test') returning id into v_uid_b;
  insert into auth.users (email) values ('pkc@example.test') returning id into v_uid_c;
  insert into auth.users (email) values ('pko@example.test') returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Pickem Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Elsewhere', 2026, v_uid_out, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, owner_id) values (v_league, 'Alpha', v_uid_a);
  insert into teams (league_id, name, owner_id) values (v_league, 'Bravo', v_uid_b);
  insert into team_co_owners (team_id, user_id, league_id)
    select id, v_uid_c, v_league from teams where league_id = v_league and name = 'Bravo';

  -- Three games in a fake week nothing else uses: one still open, one kicked
  -- off but live, one final.
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail)
  values ('pickem-test-g1', 9999, 2, 1, 'KC', 'BUF', now() + interval '1 day', 'pre', 'Sun 1:00 PM ET')
  returning id into v_g1;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail)
  values ('pickem-test-g2', 9999, 2, 1, 'DAL', 'GB', now() - interval '30 minutes', 'in', 'Q2 5:00')
  returning id into v_g2;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail, home_score, away_score)
  values ('pickem-test-g3', 9999, 2, 1, 'NE', 'MIA', now() - interval '3 hours', 'post', 'Final', 27, 20)
  returning id into v_g3;

  -- Picks made before their game locked, seeded directly (ff_make_pick would
  -- rightly refuse them now that the games have kicked off).
  insert into pickem_picks (league_id, game_id, user_id, selected_team) values (v_league, v_g2, v_uid_b, 'DAL');
  insert into pickem_picks (league_id, game_id, user_id, selected_team) values (v_league, v_g3, v_uid_a, 'NE');
  insert into pickem_picks (league_id, game_id, user_id, selected_team) values (v_league, v_g3, v_uid_b, 'MIA');
  -- Alpha has no pick on g2, which kicked off with none — that is a live
  -- incorrect, not a pending one. Charlie (co-owner) has no picks anywhere,
  -- proving he is tracked apart from Bravo's owner.

  -- ------------------------------------------------------- picking, live --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);

  v_j := ff_make_pick(v_league, v_g1, 'KC');
  if v_j->>'selected_team' <> 'KC' then raise exception 'the pick was not recorded as KC'; end if;
  if (select selected_team from pickem_picks where game_id = v_g1 and user_id = v_uid_a) <> 'KC' then
    raise exception 'the pick did not land in the table';
  end if;
  v_checks := v_checks + 2;

  -- Changing your mind before kickoff moves the row rather than adding one.
  perform ff_make_pick(v_league, v_g1, 'BUF');
  if (select count(*) from pickem_picks where game_id = v_g1 and user_id = v_uid_a) <> 1 then
    raise exception 'changing a pick left two rows';
  end if;
  if (select selected_team from pickem_picks where game_id = v_g1 and user_id = v_uid_a) <> 'BUF' then
    raise exception 'the changed pick did not stick';
  end if;
  v_checks := v_checks + 2;
  perform ff_make_pick(v_league, v_g1, 'KC'); -- back to KC for the rest of this test

  -- The lock: a game that has kicked off refuses a pick, server-side.
  begin
    perform ff_make_pick(v_league, v_g2, 'GB');
    raise exception 'a pick was accepted after kickoff';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a pick was accepted after kickoff' then raise; end if;
    if v_err not like '%kicked off%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- A team that isn't in the matchup can't be picked.
  begin
    perform ff_make_pick(v_league, v_g1, 'SF');
    raise exception 'a pick was accepted for a team not in the game';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a pick was accepted for a team not in the game' then raise; end if;
    if v_err not like '%not in this matchup%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- --------------------------------------------------- THE ONE: no peeking --
  v_j := ff_pickem_week(v_league, 9999, 1);
  if (v_j->>'members')::int <> 3 then raise exception 'expected 3 members, got %', v_j->>'members'; end if;

  -- g1 has not kicked off: my own pick shows, nobody else's does.
  declare v_game jsonb;
  begin
    select g into v_game from jsonb_array_elements(v_j->'games') g where g->>'game_id' = v_g1::text;
    if v_game->>'my_pick' <> 'KC' then raise exception 'my own pick on an open game was not shown'; end if;
    -- `->>` (not `->`) on purpose: a JSON null stored under the key is still a
    -- non-SQL-NULL jsonb value through `->`, so `is not null` would pass on it.
    if v_game->>'picks' is not null then raise exception 'an open game revealed the field''s picks'; end if;
    if v_game->>'distribution' is not null then raise exception 'an open game revealed its distribution'; end if;
    if (v_game->>'locked')::boolean then raise exception 'an open game reported itself locked'; end if;
  end;
  v_checks := v_checks + 4;

  -- g2 has kicked off: everyone's pick is visible, including a blank one.
  declare v_game jsonb; v_bravo text;
  begin
    select g into v_game from jsonb_array_elements(v_j->'games') g where g->>'game_id' = v_g2::text;
    if not (v_game->>'locked')::boolean then raise exception 'a kicked-off game reported itself open'; end if;
    if v_game->>'picks' is null then raise exception 'a kicked-off game still hid the picks'; end if;
    if (v_game->'distribution'->>'DAL')::int <> 1 then
      raise exception 'the distribution on a locked game read %', v_game->'distribution';
    end if;
  end;
  v_checks := v_checks + 3;

  -- ----------------------------------------------------------- the grading --
  v_j := ff_pickem_weekly_standings(v_league, 9999, 1);

  -- Alpha: g3 correct (picked NE, NE won), g2 incorrect (no pick, kicked off
  -- live), g1 remaining (still open).
  declare v_row jsonb;
  begin
    select r into v_row from jsonb_array_elements(v_j) r where (r->>'user_id')::uuid = v_uid_a;
    if (v_row->>'correct')::int <> 1 then raise exception 'alpha correct = %, expected 1', v_row->>'correct'; end if;
    if (v_row->>'incorrect')::int <> 1 then raise exception 'alpha incorrect = %, expected 1', v_row->>'incorrect'; end if;
    if (v_row->>'remaining')::int <> 1 then raise exception 'alpha remaining = %, expected 1', v_row->>'remaining'; end if;
  end;
  v_checks := v_checks + 3;

  -- Bravo (the owner): g3 incorrect (picked MIA, NE won), g2 not yet decided
  -- (his pick is in, the game just hasn't finished), g1 not yet picked.
  declare v_row jsonb;
  begin
    select r into v_row from jsonb_array_elements(v_j) r where (r->>'user_id')::uuid = v_uid_b;
    if (v_row->>'correct')::int <> 0 then raise exception 'bravo correct = %, expected 0', v_row->>'correct'; end if;
    if (v_row->>'incorrect')::int <> 1 then raise exception 'bravo incorrect = %, expected 1', v_row->>'incorrect'; end if;
    if (v_row->>'remaining')::int <> 2 then raise exception 'bravo remaining = %, expected 2', v_row->>'remaining'; end if;
  end;
  v_checks := v_checks + 3;

  -- Charlie (the co-owner): a member in his own right, tracked apart from
  -- Bravo's owner. He has no pick of his own on g2 or g3 — both have kicked
  -- off, so the NO PICK rule makes both incorrect immediately; only g1 (still
  -- open) is remaining. If he shared Bravo's picks this would read 0/1/2.
  declare v_row jsonb;
  begin
    select r into v_row from jsonb_array_elements(v_j) r where (r->>'user_id')::uuid = v_uid_c;
    if v_row is null then raise exception 'the co-owner was not counted as a member'; end if;
    if (v_row->>'correct')::int <> 0 or (v_row->>'incorrect')::int <> 2 or (v_row->>'remaining')::int <> 1 then
      raise exception 'charlie''s picks were not independent of bravo''s: %', v_row;
    end if;
  end;
  v_checks := v_checks + 2;

  -- Alpha, having a decided win and no losses yet, ranks above Bravo.
  if (select (r->>'rank')::int from jsonb_array_elements(v_j) r where (r->>'user_id')::uuid = v_uid_a)
     >= (select (r->>'rank')::int from jsonb_array_elements(v_j) r where (r->>'user_id')::uuid = v_uid_b) then
    raise exception 'alpha did not outrank bravo after going 1-1 to bravo''s 0-1';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- the season --
  v_j := ff_pickem_season_standings(v_league, 9999);
  if (select (r->>'weekly_wins')::int from jsonb_array_elements(v_j) r where (r->>'user_id')::uuid = v_uid_a) <> 1 then
    raise exception 'alpha did not win the only decided week';
  end if;
  if (select (r->>'weekly_wins')::int from jsonb_array_elements(v_j) r where (r->>'user_id')::uuid = v_uid_b) <> 0 then
    raise exception 'bravo was credited a weekly win he did not have';
  end if;
  v_checks := v_checks + 2;

  -- -------------------------------------------- a week nobody could play --
  -- Two final games in a week where the league made no picks at all — the
  -- way week 1 of the real season went before Pick'em existed. Nobody
  -- should be charged an incorrect for a week he never had the chance to
  -- play; everyone reads 0 correct, 0 incorrect, both games remaining.
  declare v_g4 uuid; v_g5 uuid; v_row jsonb;
  begin
    insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                           kickoff_at, status, status_detail, home_score, away_score)
    values ('pickem-test-g4', 9999, 2, 2, 'MIA', 'NYJ', now() - interval '1 day', 'post', 'Final', 24, 10)
    returning id into v_g4;
    insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                           kickoff_at, status, status_detail, home_score, away_score)
    values ('pickem-test-g5', 9999, 2, 2, 'LAR', 'ARI', now() - interval '1 day', 'post', 'Final', 17, 20)
    returning id into v_g5;

    v_j := ff_pickem_weekly_standings(v_league, 9999, 2);
    for v_row in select value from jsonb_array_elements(v_j) loop
      if (v_row->>'correct')::int <> 0 or (v_row->>'incorrect')::int <> 0 or (v_row->>'remaining')::int <> 2 then
        raise exception 'a week with no league-wide picks graded somebody: %', v_row;
      end if;
    end loop;
  end;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the refusals --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_make_pick(v_league, v_g1, 'KC');
    raise exception 'an outsider picked in a league he is not in';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider picked in a league he is not in' then raise; end if;
    if v_err not like '%not a member%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  begin
    perform ff_pickem_week(v_league, 9999, 1);
    raise exception 'an outsider read a league''s board he is not in';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider read a league''s board he is not in' then raise; end if;
    if v_err not like '%not a member%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 2;

  -- --------------------------------------------------- the ballot stays own --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  set local role authenticated;
  if (select count(*) from pickem_picks where league_id = v_league) <> 2 then
    raise exception 'a manager could read % picks, expected only his own',
      (select count(*) from pickem_picks where league_id = v_league);
  end if;
  reset role;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may write --
  if has_table_privilege('authenticated', 'public.pickem_picks', 'insert') then
    raise exception 'a manager can insert a pick directly, bypassing the lock check';
  end if;
  if has_function_privilege('anon', 'public.ff_make_pick(uuid,uuid,text)', 'execute') then
    raise exception 'anon can make a pick';
  end if;
  if has_function_privilege('anon', 'public.ff_pickem_week(uuid,integer,integer)', 'execute') then
    raise exception 'anon can read a league''s board';
  end if;
  v_checks := v_checks + 3;

  raise notice 'pickem: % checks passed', v_checks;
end $$;

rollback;
