-- ============================================================================
-- Waivers, exercised against a seeded league.
--
-- Rolling priority is the kind of rule that reads obviously and settles
-- wrongly, so the fixture is built so the right answer is checkable by hand:
-- three teams, a known order, and claims that deliberately collide.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_draft uuid;
  v_a uuid; v_b uuid; v_c uuid;      -- teams, in that waiver order
  v_uid_a uuid;
  v_week integer := 5;
  v_p1 uuid; v_p2 uuid;              -- players who will be dropped onto waivers
  v_free uuid;                       -- never owned: a free agent, not a waiver
  v_j jsonb; v_err text; v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values ('AAA','Alpha','AAA')
    on conflict (id) do nothing;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at)
  values ('w-1', 2026, 2, v_week, 'AAA', 'AAA', now() + interval '3 days');

  insert into leagues (name, season, team_count, roster_slots, settings)
  values ('Waiver Test', 2026, 3,
          -- Seven, so five drafted leaves room for a signing AND a claim. A
          -- tighter cap would make B's second claim fail for lack of room and
          -- the fall-through below would pass for the wrong reason.
          '["QB","RB","WR","BN","BN","BN","BN"]'::jsonb,
          '{"waiver_type":"rolling_priority","waiver_run_day":"wednesday"}'::jsonb)
  returning id into v_league;

  insert into teams (league_id, name, draft_slot) values (v_league,'A',3) returning id into v_a;
  insert into teams (league_id, name, draft_slot) values (v_league,'B',2) returning id into v_b;
  insert into teams (league_id, name, draft_slot) values (v_league,'C',1) returning id into v_c;

  insert into auth.users (email) values ('wa@example.test') returning id into v_uid_a;
  update teams set owner_id = v_uid_a where id = v_a;
  update leagues set commissioner_id = v_uid_a where id = v_league;

  insert into players (full_name, position, nfl_team, status, sleeper_id)
  select 'W Player ' || lpad(g::text,2,'0'),
         (array['QB','RB','WR'])[1 + (g % 3)], 'AAA', 'ACT', 'wtest-' || g
    from generate_series(1, 20) g;

  insert into drafts (league_id, rounds, status) values (v_league, 5, 'complete') returning id into v_draft;

  -- 5 each to A, B, C.
  insert into draft_picks (draft_id, pick_number, round, team_id, player_id)
  select v_draft, row_number() over (order by p.full_name),
         1 + ((row_number() over (order by p.full_name) - 1) / 3)::int,
         (array[v_a, v_b, v_c])[1 + ((row_number() over (order by p.full_name) - 1) % 3)],
         p.id
    from (select id, full_name from players where sleeper_id like 'wtest-%'
           order by full_name limit 15) p;

  select p.id into v_free from players p
   where p.sleeper_id like 'wtest-%'
     and not exists (select 1 from draft_picks dp where dp.player_id = p.id) limit 1;

  -- ------------------------------------------------- priority off the draft --
  -- Reverse draft order: the manager who picked last gets first call.
  perform ff_seed_waiver_priority(v_league);
  if (select waiver_priority from teams where id = v_a) <> 1
     or (select waiver_priority from teams where id = v_c) <> 3 then
    raise exception 'waiver priority did not come off the reverse draft order';
  end if;
  v_checks := v_checks + 1;

  -- -------------------------------------------- a drop puts a man on waivers --
  select dp.player_id into v_p1 from draft_picks dp where dp.team_id = v_c limit 1;
  select dp.player_id into v_p2 from draft_picks dp where dp.team_id = v_c
    and dp.player_id <> v_p1 limit 1;

  perform ff_add_drop(v_c, null, v_p1, v_week);
  perform ff_add_drop(v_c, null, v_p2, v_week);

  if (select count(*) from ff_on_waivers(v_league)) <> 2 then
    raise exception 'expected 2 players on waivers, got %',
      (select count(*) from ff_on_waivers(v_league));
  end if;
  v_checks := v_checks + 1;

  -- A player nobody ever owned is a free agent, not a waiver.
  if exists (select 1 from ff_on_waivers(v_league) w where w.player_id = v_free) then
    raise exception 'a never-owned player was put on waivers';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------- and takes him off the market --
  begin
    perform ff_add_drop(v_b, v_p1, null, v_week);
    raise exception 'a player on waivers was signed outright';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%on waivers%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- The free agent is still signable on the spot, which is the whole contrast.
  perform ff_add_drop(v_b, v_free, null, v_week);
  if (select team_id from ff_owner_at(v_league, v_week) where player_id = v_free) <> v_b then
    raise exception 'a free agent could not be signed while waivers were live';
  end if;
  v_checks := v_checks + 1;

  -- ----------------------------------------------------------- the claims --
  -- A and B both want v_p1; A has priority 1. B also wants v_p2 as a backup.
  perform ff_claim_waiver(v_a, v_p1, null, 1);
  perform ff_claim_waiver(v_b, v_p1, null, 1);
  perform ff_claim_waiver(v_b, v_p2, null, 2);

  -- Claiming a free agent is refused: he is not on waivers, sign him.
  begin
    perform ff_claim_waiver(v_a, v_free, null, 1);
    raise exception 'a claim was accepted on a player who is not on waivers';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%not on waivers%' and v_err not like '%on a roster%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- Re-claiming replaces rather than duplicating.
  perform ff_claim_waiver(v_a, v_p1, null, 1);
  if (select count(*) from waiver_claims
       where team_id = v_a and add_player_id = v_p1 and status = 'pending') <> 1 then
    raise exception 'a repeated claim entered twice instead of replacing';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the settling --
  v_j := ff_run_waivers(v_league, v_week);
  if (v_j->>'claims_awarded')::int <> 2 then
    raise exception 'expected 2 awards, got %  (%)', v_j->>'claims_awarded', v_j;
  end if;
  v_checks := v_checks + 1;

  -- A had first call and takes v_p1. B loses that one and gets v_p2 instead.
  if (select team_id from ff_owner_at(v_league, v_week) where player_id = v_p1) <> v_a then
    raise exception 'priority 1 did not win the contested player';
  end if;
  if (select team_id from ff_owner_at(v_league, v_week) where player_id = v_p2) <> v_b then
    raise exception 'the losing team did not fall through to its second claim';
  end if;
  v_checks := v_checks + 1;

  -- The loser is told, in words, rather than left pending.
  if (select status from waiver_claims where team_id = v_b and add_player_id = v_p1)
     <> 'lost' then
    raise exception 'a beaten claim was not marked lost';
  end if;
  if (select outcome from waiver_claims where team_id = v_b and add_player_id = v_p1) is null then
    raise exception 'a beaten claim carries no explanation';
  end if;
  v_checks := v_checks + 1;

  -- Winning sends you to the back; the order stays 1..n with no gaps.
  if (select waiver_priority from teams where id = v_a) <= 1 then
    raise exception 'winning a claim did not cost the winner his priority';
  end if;
  select count(distinct waiver_priority) into v_n from teams where league_id = v_league;
  if v_n <> 3 or (select max(waiver_priority) from teams where league_id = v_league) <> 3 then
    raise exception 'waiver order is not a contiguous 1..n after a run';
  end if;
  v_checks := v_checks + 1;

  -- A won claim is an ordinary transaction, so the ledger and the cache agree.
  if (select count(*) from transactions where league_id = v_league and kind = 'waiver') <> 2 then
    raise exception 'winning claims did not become waiver transactions';
  end if;
  if not exists (select 1 from rosters where team_id = v_a and week = v_week and player_id = v_p1) then
    raise exception 'a won player never reached the roster cache';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- and the wire is clear --
  -- Both were awarded, and the run is recorded, so nothing is still on waivers.
  if (select count(*) from ff_on_waivers(v_league)) <> 0 then
    raise exception 'players are still on waivers after being awarded';
  end if;
  v_checks := v_checks + 1;

  -- A second run with nothing pending is harmless.
  v_j := ff_run_waivers(v_league, v_week);
  if (v_j->>'claims_awarded')::int <> 0 then
    raise exception 'a second run awarded something out of nothing';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------------------------------- what a manager sees --
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_waiver_board(v_a);
  if v_j->>'settles_at' is null or jsonb_array_length(v_j->'order') <> 3 then
    raise exception 'the waiver board is missing its order or its next settlement';
  end if;
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 1;

  raise notice 'waivers: % checks passed', v_checks;
end $$;

rollback;
