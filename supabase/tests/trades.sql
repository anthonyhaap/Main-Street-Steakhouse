-- ============================================================================
-- Trades, exercised against a seeded league.
--
-- The negotiation is a state machine and the execution is a roster change, so
-- the checks come in two halves: what an offer may become and who may push it
-- there, and what actually moves when somebody says yes.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_draft uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_uid_a uuid; v_uid_b uuid;
  v_week integer := 5;
  v_a1 uuid; v_a2 uuid; v_b1 uuid; v_b2 uuid; v_c1 uuid;
  v_t uuid; v_t2 uuid; v_j jsonb; v_err text; v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values ('AAA','Alpha','AAA')
    on conflict (id) do nothing;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at)
  values ('tr-1', 2026, 2, v_week, 'AAA', 'AAA', now() + interval '3 days');

  insert into leagues (name, season, team_count, roster_slots, settings)
  values ('Trade Test', 2026, 3, '["QB","RB","WR","BN","BN"]'::jsonb,
          '{"trade_deadline_week": 12}'::jsonb)
  returning id into v_league;

  insert into teams (league_id, name) values (v_league,'A') returning id into v_a;
  insert into teams (league_id, name) values (v_league,'B') returning id into v_b;
  insert into teams (league_id, name) values (v_league,'C') returning id into v_c;

  insert into auth.users (email) values ('ta@example.test') returning id into v_uid_a;
  insert into auth.users (email) values ('tb@example.test') returning id into v_uid_b;
  update teams set owner_id = v_uid_a where id = v_a;
  update teams set owner_id = v_uid_b where id = v_b;

  insert into players (full_name, position, nfl_team, status, sleeper_id)
  select 'T Player ' || lpad(g::text,2,'0'),
         (array['QB','RB','WR'])[1 + (g % 3)], 'AAA', 'ACT', 'ttest-' || g
    from generate_series(1, 15) g;

  insert into drafts (league_id, rounds, status) values (v_league, 5, 'complete') returning id into v_draft;
  insert into draft_picks (draft_id, pick_number, round, team_id, player_id)
  select v_draft, row_number() over (order by p.full_name),
         1 + ((row_number() over (order by p.full_name) - 1) / 3)::int,
         (array[v_a, v_b, v_c])[1 + ((row_number() over (order by p.full_name) - 1) % 3)],
         p.id
    from (select id, full_name from players where sleeper_id like 'ttest-%'
           order by full_name limit 15) p;

  select o.player_id into v_a1 from ff_owner_at(v_league, v_week) o where o.team_id = v_a limit 1;
  select o.player_id into v_a2 from ff_owner_at(v_league, v_week) o
   where o.team_id = v_a and o.player_id <> v_a1 limit 1;
  select o.player_id into v_b1 from ff_owner_at(v_league, v_week) o where o.team_id = v_b limit 1;
  select o.player_id into v_b2 from ff_owner_at(v_league, v_week) o
   where o.team_id = v_b and o.player_id <> v_b1 limit 1;
  select o.player_id into v_c1 from ff_owner_at(v_league, v_week) o where o.team_id = v_c limit 1;

  -- ------------------------------------------------------------- the block --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  if ff_set_trade_block(v_a, array[v_a1, v_a2], 'need a receiver') <> 2 then
    raise exception 'the trade block did not take two players';
  end if;
  -- Listing somebody else's player is an advert for a car you sold.
  begin
    perform ff_set_trade_block(v_a, array[v_b1]);
    raise exception 'a manager listed another team''s player';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%only list players you own%' then raise; end if;
  end;
  -- The list is the whole list: re-setting it removes what is left out.
  if ff_set_trade_block(v_a, array[v_a1]) <> 1 then
    raise exception 'resetting the block did not drop the player left out';
  end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------------ the offer --
  v_j := ff_propose_trade(v_a, v_b, array[v_a1], array[v_b1], 'straight swap');
  v_t := (v_j->>'trade_id')::uuid;
  if (v_j->>'status') <> 'proposed' then raise exception 'offer did not land'; end if;
  v_checks := v_checks + 1;

  -- Only the team it was offered to may answer it.
  begin
    perform ff_respond_trade(v_t, 'accepted');
    raise exception 'the proposer accepted his own offer';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%only the team it was offered to%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- Offering somebody you do not own.
  begin
    perform ff_propose_trade(v_a, v_b, array[v_c1], array[v_b1]);
    raise exception 'a manager offered a player he does not own';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%not on the offering roster%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- Trading with yourself, and an empty trade.
  begin
    perform ff_propose_trade(v_a, v_a, array[v_a1], '{}');
    raise exception 'a manager traded with himself';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%trade with yourself%' then raise; end if;
  end;
  begin
    perform ff_propose_trade(v_a, v_b, '{}', '{}');
    raise exception 'an empty trade was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%nobody in it%' then raise; end if;
  end;
  v_checks := v_checks + 2;

  -- ----------------------------------------------------------- the counter --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  v_j := ff_propose_trade(v_b, v_a, array[v_b2], array[v_a1], 'not him, this one', v_t);
  v_t2 := (v_j->>'trade_id')::uuid;

  -- Countering closes the offer it answers, and links the thread.
  if (select status from trades where id = v_t) <> 'countered' then
    raise exception 'countering did not close the offer it answered';
  end if;
  if (select counters_id from trades where id = v_t2) <> v_t then
    raise exception 'the counter is not linked to what it countered';
  end if;
  v_checks := v_checks + 2;

  -- A closed offer cannot be answered again.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  begin
    perform ff_respond_trade(v_t, 'accepted');
    raise exception 'a countered offer was still acceptable';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%already countered%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the handshake --
  v_j := ff_respond_trade(v_t2, 'accepted');
  if (v_j->>'status') <> 'accepted' then raise exception 'the counter was not accepted'; end if;

  -- Both players moved, both ways.
  if (select team_id from ff_owner_at(v_league, v_week) where player_id = v_b2) <> v_a
     or (select team_id from ff_owner_at(v_league, v_week) where player_id = v_a1) <> v_b then
    raise exception 'the accepted trade did not move both players';
  end if;
  v_checks := v_checks + 2;

  -- It is an ordinary transaction, so the cache and the ledger agree.
  if (select count(*) from transactions where league_id = v_league and kind = 'trade') <> 1 then
    raise exception 'an accepted trade did not become a trade transaction';
  end if;
  if not exists (select 1 from rosters where team_id = v_a and week = v_week and player_id = v_b2)
     or exists (select 1 from rosters where team_id = v_a and week = v_week and player_id = v_a1) then
    raise exception 'the roster cache disagrees with the trade';
  end if;
  v_checks := v_checks + 2;

  -- A traded player comes off the block.
  if exists (select 1 from trade_block where player_id = v_a1) then
    raise exception 'a traded player is still advertised';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------- offers overtaken by events --
  -- A live offer naming a player who has since been traded is nonsense, and is
  -- told so rather than left for the next manager to discover by pressing yes.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  declare v_t3 uuid; v_t4 uuid;
  begin
    v_j := ff_propose_trade(v_a, v_c, array[v_a2], array[v_c1], 'one for one');
    v_t3 := (v_j->>'trade_id')::uuid;
    v_j := ff_propose_trade(v_a, v_b, array[v_a2], array[v_b1], 'same man, other club');
    v_t4 := (v_j->>'trade_id')::uuid;

    perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
    perform ff_respond_trade(v_t4, 'accepted');

    if (select status from trades where id = v_t3) <> 'invalid' then
      raise exception 'an offer naming an already-traded player stayed live';
    end if;
    if (select outcome from trades where id = v_t3) is null then
      raise exception 'the invalidated offer carries no explanation';
    end if;
  end;
  v_checks := v_checks + 2;

  -- ---------------------------------------------------------- the deadline --
  -- Week 13 is past the league's own week-12 deadline.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  -- The week is an argument, so the deadline is checked without moving a clock
  -- that lives in a view.
  begin
    perform ff_validate_trade(v_league, v_a, v_b, array[v_a2], '{}', 13);
    raise exception 'a trade after the deadline was allowed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%deadline%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------- the desk --
  v_j := ff_trade_desk(v_a);
  if v_j->>'deadline_week' <> '12' then raise exception 'the desk lost the deadline'; end if;
  if jsonb_array_length(v_j->'offers') < 3 then
    raise exception 'the desk is missing this team''s offers';
  end if;
  v_checks := v_checks + 1;

  -- And it is nobody else's desk.
  begin
    perform ff_trade_desk(v_b);
    raise exception 'a manager read another team''s trade desk';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%not your team%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 1;

  -- ------------------------------------------------- the offer is private --
  -- Every other check in this file runs as the owner of the database, which
  -- bypasses RLS entirely — so "a live offer is between the two of them" has
  -- been an untested claim. This is the one place the policies themselves are
  -- exercised, as the `authenticated` role a browser actually arrives as.
  declare
    v_uid_c uuid;
    v_seen  integer;
    v_live  uuid;
  begin
    insert into auth.users (email) values ('tc@example.test') returning id into v_uid_c;
    update teams set owner_id = v_uid_c where id = v_c;

    -- Picked from what each side owns *now*: several players have changed
    -- hands above, so naming them from the fixture would be stale.
    declare v_mine uuid; v_theirs uuid;
    begin
      select o.player_id into v_mine from ff_owner_at(v_league, v_week) o
       where o.team_id = v_a limit 1;
      select o.player_id into v_theirs from ff_owner_at(v_league, v_week) o
       where o.team_id = v_b limit 1;

      perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
      v_j := ff_propose_trade(v_a, v_b, array[v_mine], array[v_theirs], 'a live one');
      v_live := (v_j->>'trade_id')::uuid;
    end;

    -- C is a member of this league and a party to nothing.
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid_c)::text, true);
    set local role authenticated;

    select count(*) into v_seen from trades where id = v_live;
    if v_seen <> 0 then
      raise exception 'a third manager could read a live offer he is not part of';
    end if;
    select count(*) into v_seen from trade_items where trade_id = v_live;
    if v_seen <> 0 then
      raise exception 'a third manager could read the contents of a live offer';
    end if;

    -- And a settled one is the league's business.
    select count(*) into v_seen from trades where status = 'accepted';
    if v_seen = 0 then
      raise exception 'a settled trade was hidden from the league';
    end if;

    reset role;
    perform set_config('request.jwt.claims', '', true);
  end;
  v_checks := v_checks + 3;

  raise notice 'trades: % checks passed', v_checks;
end $$;

rollback;
