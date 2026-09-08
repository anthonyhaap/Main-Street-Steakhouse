-- ============================================================================
-- Two leagues in one database, which is the case every membership policy
-- claimed to handle and none of them did.
--
-- Until ff_is_member took an argument there was no way to write this file: with
-- a single league, "a member of this league" and "a member of any league" admit
-- exactly the same rows, and every assertion passes either way. So this builds
-- the second league and asks the only question that separates them — can a
-- manager in league B see league A's rows — of every table that has a policy.
--
-- The reverse is asserted too. A guard that denies everybody is easy to write
-- by accident, and it would pass a one-sided test while breaking the league.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_a uuid; v_b uuid;            -- the two leagues
  v_ada uuid; v_bo uuid;         -- a manager in each
  v_team_a uuid; v_team_b uuid;
  v_draft_a uuid; v_poll_a uuid; v_trade_a uuid; v_txn_a uuid;
  v_player uuid;
  v_n integer;
  v_checks integer := 0;

  -- Every league-scoped table, and how to count what the caller can see of
  -- league A's rows in it.
  v_tables text[] := array[
    'activity_events', 'challenges', 'drafts', 'historical_standings',
    'league_history', 'league_messages', 'league_recaps',
    'league_scoring_rules', 'matchups', 'polls', 'reactions', 'teams',
    'transactions', 'waiver_runs'
  ];
  t text;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('ada@example.test') returning id into v_ada;
  insert into auth.users (email) values ('bo@example.test')  returning id into v_bo;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('League A', 2026, v_ada, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_a;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('League B', 2026, v_bo,  '["QB"]'::jsonb, '{}'::jsonb) returning id into v_b;

  insert into teams (league_id, name, manager_name, owner_id)
  values (v_a, 'Alpha', 'Ada', v_ada) returning id into v_team_a;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_b, 'Bravo', 'Bo', v_bo) returning id into v_team_b;

  -- One row of league A's business in every table Bo must not see.
  insert into activity_events (league_id, event_type, headline)
    values (v_a, 'trade', 'A trade in league A');
  insert into challenges (league_id, challenger_id, opponent_id, title, terms, stake_label)
    values (v_a, v_ada, v_bo, 'A challenge', 'terms', 'pride');
  insert into drafts (league_id, status) values (v_a, 'setup') returning id into v_draft_a;
  insert into historical_standings (league_id, season, final_rank, team_name, manager_names)
    values (v_a, 2025, 1, 'Alpha', 'Ada');
  insert into league_history (league_id, season, week, round, home_manager, away_manager,
                              home_team, away_team, home_points, away_points)
    values (v_a, 2025, 1, 'regular', 'Ada', 'Ghost', 'Alpha', 'Ghost', 100, 90);
  insert into league_messages (league_id, author_id, body) values (v_a, v_ada, 'private to league A');
  insert into league_recaps (league_id, week, facts, body)
    values (v_a, 1, '{}'::jsonb, 'A recap');
  insert into league_scoring_rules (league_id, effective_from_week, rules)
    values (v_a, 1, '{"pass_yd": 0.04}'::jsonb);
  insert into matchups (league_id, week, home_team_id, away_team_id)
    values (v_a, 1, v_team_a, v_team_a);
  insert into polls (league_id, author_id, question) values (v_a, v_ada, 'A question') returning id into v_poll_a;
  insert into poll_options (poll_id, label, seq) values (v_poll_a, 'Yes', 1);
  insert into reactions (league_id, source, target_id, user_id, emoji)
    values (v_a, 'message', v_poll_a, v_ada, '🔥');
  insert into transactions (league_id, kind, week, actor_id)
    values (v_a, 'add', 1, v_ada) returning id into v_txn_a;
  insert into waiver_runs (league_id, week) values (v_a, 1);

  select id into v_player from players limit 1;
  if v_player is not null then
    insert into draft_picks (draft_id, team_id, player_id, pick_number, round)
      values (v_draft_a, v_team_a, v_player, 1, 1);
    insert into rosters (team_id, player_id, week, slot) values (v_team_a, v_player, 1, 'QB');
    insert into trade_block (team_id, player_id) values (v_team_a, v_player);
    insert into transaction_items (transaction_id, player_id, to_team_id)
      values (v_txn_a, v_player, v_team_a);
  end if;

  -- ------------------------------------------------- the outsider's view --
  -- Bo owns a team, so ff_is_member() — the vague one — is true for him. That
  -- is exactly the condition under which every one of these policies used to
  -- let him read another league's rows.
  perform set_config('request.jwt.claims', json_build_object('sub', v_bo)::text, true);
  perform set_config('role', 'authenticated', true);

  foreach t in array v_tables loop
    execute format('select count(*) from public.%I where league_id = $1', t)
       into v_n using v_a;
    if v_n <> 0 then
      raise exception 'a manager from another league read % rows of league A''s %', v_n, t;
    end if;
    v_checks := v_checks + 1;
  end loop;

  -- The league row itself.
  select count(*) into v_n from leagues where id = v_a;
  if v_n <> 0 then raise exception 'an outsider read league A''s own row'; end if;

  -- And the tables that reach their league through a parent.
  select count(*) into v_n from draft_picks where draft_id = v_draft_a;
  if v_n <> 0 then raise exception 'an outsider read league A''s draft picks'; end if;
  select count(*) into v_n from rosters where team_id = v_team_a;
  if v_n <> 0 then raise exception 'an outsider read league A''s rosters'; end if;
  select count(*) into v_n from trade_block where team_id = v_team_a;
  if v_n <> 0 then raise exception 'an outsider read league A''s trade block'; end if;
  select count(*) into v_n from transaction_items where transaction_id = v_txn_a;
  if v_n <> 0 then raise exception 'an outsider read league A''s transaction items'; end if;
  select count(*) into v_n from poll_options where poll_id = v_poll_a;
  if v_n <> 0 then raise exception 'an outsider read league A''s poll options'; end if;
  v_checks := v_checks + 6;

  -- He cannot write into it either.
  begin
    perform ff_send_message(v_a, 'hello from the wrong league');
    raise exception 'an outsider posted into league A''s house';
  exception when others then
    if sqlerrm = 'an outsider posted into league A''s house' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- --------------------------------------------------- the member's view --
  -- The other half, and the reason this is not just "deny everything": Ada
  -- must still see her own league. A guard that refuses everybody would pass
  -- every assertion above.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ada)::text, true);

  foreach t in array v_tables loop
    execute format('select count(*) from public.%I where league_id = $1', t)
       into v_n using v_a;
    if v_n = 0 then
      raise exception 'league A''s own commissioner cannot see its %', t;
    end if;
    v_checks := v_checks + 1;
  end loop;

  select count(*) into v_n from leagues where id = v_a;
  if v_n <> 1 then raise exception 'a commissioner cannot see her own league'; end if;
  select count(*) into v_n from poll_options where poll_id = v_poll_a;
  if v_n = 0 then raise exception 'a member cannot see her own league''s poll options'; end if;
  v_checks := v_checks + 2;

  if v_player is not null then
    select count(*) into v_n from rosters where team_id = v_team_a;
    if v_n = 0 then raise exception 'a member cannot see her own league''s rosters'; end if;
    select count(*) into v_n from draft_picks where draft_id = v_draft_a;
    if v_n = 0 then raise exception 'a member cannot see her own league''s draft picks'; end if;
    v_checks := v_checks + 2;
  end if;

  -- And she can still talk in it.
  perform ff_send_message(v_a, 'hello from the right league');
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- anon's view --
  -- The reference tables were readable by anybody holding the publishable key.
  perform set_config('request.jwt.claims', null, true);
  if has_table_privilege('anon', 'public.players', 'select')
  or has_table_privilege('anon', 'public.player_projections', 'select')
  or has_table_privilege('anon', 'public.player_season_projections', 'select')
  or has_table_privilege('anon', 'public.player_stat_lines', 'select')
  or has_table_privilege('anon', 'public.player_adp', 'select')
  or has_table_privilege('anon', 'public.nfl_games', 'select')
  or has_table_privilege('anon', 'public.nfl_teams', 'select')
  or has_table_privilege('anon', 'public.player_id_map', 'select') then
    raise exception 'the reference tables are still readable by anon';
  end if;
  -- No table at all, in fact.
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, 'select');
  if v_n <> 0 then
    raise exception 'anon can still select from % table(s)', v_n;
  end if;
  v_checks := v_checks + 2;

  -- But the one thing anon is meant to reach still works: the share card and
  -- the invite screen are SECURITY DEFINER and need no grant of their own.
  if not has_function_privilege('anon', 'public.ff_share_card(uuid)', 'execute') then
    raise exception 'anon can no longer open a shared card';
  end if;
  v_checks := v_checks + 1;

  raise notice 'two leagues: % checks passed', v_checks;
end $$;

rollback;
