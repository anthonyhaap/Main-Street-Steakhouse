-- ============================================================================
-- A week in the life: the features against each other.
--
-- Every other suite here tests one feature in isolation, and all of them pass.
-- This one exists because the app has never run a week where add/drop, waivers
-- and trades were all happening to the same players at the same time — the
-- draft is still in setup on the live project — and that is where the
-- interesting failures live. A rule that is right on its own can still be wrong
-- about a player the other two features are also touching.
--
-- So this drives the real RPCs, in the order a Tuesday actually happens, and
-- then checks the two things that must be true no matter what route the players
-- took: that everybody who reads ownership agrees, and that the two screens
-- which read EVERYTHING — the ledger and the House — say the same thing as the
-- database underneath them.
--
-- Deliberately no jwt claims for most of it. auth.uid() null is the service
-- role path, which is how the crons and the settlement run; the authorisation
-- rules already have their own suites and re-testing them here would only make
-- this file longer without making it braver.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_draft uuid; v_game uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_uid_a uuid;
  v_week integer;
  v_dropped uuid;        -- A releases him; he becomes the week's prize
  v_second uuid;         -- A releases him too; C and D both want him
  v_free uuid;           -- never owned by anyone
  v_b_keep uuid;         -- B names him to make way, then trades him
  v_uid_b uuid; v_uid_c uuid; v_uid_d uuid;
  v_j jsonb; v_err text; v_n integer; v_owner uuid;
  v_trade uuid; v_claim_b uuid;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  v_week := greatest(1, ff_current_week());

  insert into nfl_teams (id, name, espn_id) values ('SEA','Season','SEA')
    on conflict (id) do nothing;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at)
  values ('season-1', 2026, 2, v_week, 'SEA', 'SEA', now() + interval '3 days')
  returning id into v_game;

  insert into leagues (name, season, team_count, roster_slots, settings)
  values ('Season Rehearsal', 2026, 4,
          -- Eight slots against six drafted: room to sign and to claim, so a
          -- refusal below is never a roster-cap refusal wearing another name.
          '["QB","RB","WR","BN","BN","BN","BN","BN"]'::jsonb,
          '{"waiver_type":"rolling_priority","waiver_run_day":"wednesday",
            "trade_deadline_week":20}'::jsonb)
  returning id into v_league;

  -- Slots ascending, because waiver priority is the REVERSE of the draft: the
  -- club that picked last gets first call. Delta on slot 4 is therefore ahead
  -- of Charlie on 3, which is what the contested claim below turns on.
  insert into teams (league_id, name, draft_slot) values (v_league,'Alpha',1)  returning id into v_a;
  insert into teams (league_id, name, draft_slot) values (v_league,'Bravo',2)  returning id into v_b;
  insert into teams (league_id, name, draft_slot) values (v_league,'Charlie',3) returning id into v_c;
  insert into teams (league_id, name, draft_slot) values (v_league,'Delta',4)  returning id into v_d;

  insert into auth.users (email) values ('season@example.test') returning id into v_uid_a;
  update teams   set owner_id = v_uid_a where id = v_a;
  update leagues set commissioner_id = v_uid_a where id = v_league;

  insert into players (full_name, position, nfl_team, status, sleeper_id)
  select 'S Player ' || lpad(g::text,2,'0'),
         (array['QB','RB','WR'])[1 + (g % 3)], 'SEA', 'ACT', 'stest-' || g
    from generate_series(1, 30) g;

  insert into drafts (league_id, rounds, status) values (v_league, 6, 'complete') returning id into v_draft;

  -- Six each to the four clubs.
  insert into draft_picks (draft_id, pick_number, round, team_id, player_id)
  select v_draft, row_number() over (order by p.full_name),
         1 + ((row_number() over (order by p.full_name) - 1) / 4)::int,
         (array[v_a, v_b, v_c, v_d])[1 + ((row_number() over (order by p.full_name) - 1) % 4)],
         p.id
    from (select id, full_name from players where sleeper_id like 'stest-%'
           order by full_name limit 24) p;

  select p.id into v_free from players p
   where p.sleeper_id like 'stest-%'
     and not exists (select 1 from draft_picks dp where dp.player_id = p.id) limit 1;

  perform ff_seed_waiver_priority(v_league);

  -- Give the other three clubs owners with a phone each. push.sql already
  -- proves the triggers fire on a hand-written insert; what nothing covers is
  -- whether a real week, driven through the real RPCs, tells the right people
  -- the right number of times. Notifications are the one feature whose failure
  -- mode is silent — nobody reports a message they never got.
  insert into auth.users (email) values ('bravo@example.test')   returning id into v_uid_b;
  insert into auth.users (email) values ('charlie@example.test') returning id into v_uid_c;
  insert into auth.users (email) values ('delta@example.test')   returning id into v_uid_d;
  update teams set owner_id = v_uid_b where id = v_b;
  update teams set owner_id = v_uid_c where id = v_c;
  update teams set owner_id = v_uid_d where id = v_d;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_save_push_subscription('https://push.example/bravo', 'k', 'a', 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_c)::text, true);
  perform ff_save_push_subscription('https://push.example/charlie', 'k', 'a', 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_d)::text, true);
  perform ff_save_push_subscription('https://push.example/delta', 'k', 'a', 'test');
  perform set_config('request.jwt.claims', null, true);

  -- ================================================================ Tuesday --
  -- Alpha clears two off his bench.
  select dp.player_id into v_dropped from draft_picks dp where dp.team_id = v_a order by dp.pick_number limit 1;
  select dp.player_id into v_second  from draft_picks dp where dp.team_id = v_a
    and dp.player_id <> v_dropped order by dp.pick_number limit 1;

  perform ff_add_drop(v_a, null, v_dropped, v_week);
  perform ff_add_drop(v_a, null, v_second,  v_week);

  if (select count(*) from ff_on_waivers(v_league)) <> 2 then
    raise exception 'two drops did not produce two men on the wire';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------------- SEAM: free agency must respect the wire --
  -- These two features read the same pool and must not disagree about it. If
  -- add/drop could sign a man off waivers, every claim filed against him would
  -- settle on Wednesday against nothing.
  begin
    perform ff_add_drop(v_b, v_dropped, null, v_week);
    raise exception 'a manager signed a player who was on waivers';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager signed a player who was on waivers' then raise; end if;
    if v_err not like '%on waivers%' then
      raise exception 'refused for the wrong reason: %', v_err;
    end if;
  end;
  v_checks := v_checks + 1;

  -- ...but a man nobody ever owned is still signable on the spot. The contrast
  -- is the whole point of having a wire at all.
  perform ff_add_drop(v_b, v_free, null, v_week);
  if (select o.team_id from ff_owner_at(v_league, v_week) o where o.player_id = v_free) is distinct from v_b then
    raise exception 'a free agent could not be signed while the wire was busy';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------ SEAM: a trade cannot move a free man --
  -- Charlie tries to trade away somebody who is sitting on waivers. The trade
  -- validator and ff_owner_at have to agree that he is nobody's to give.
  begin
    perform ff_validate_trade(v_league, v_c, v_d, array[v_dropped], '{}'::uuid[], v_week);
    raise exception 'a trade offered a player who was on waivers';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a trade offered a player who was on waivers' then raise; end if;
    if v_err not like '%not on the offering roster%' then
      raise exception 'the trade was refused for the wrong reason: %', v_err;
    end if;
  end;
  v_checks := v_checks + 1;

  -- ================================================== Tuesday night: claims --
  -- Bravo wants the man Alpha dropped, and names one of his own to make way.
  select dp.player_id into v_b_keep from draft_picks dp where dp.team_id = v_b order by dp.pick_number limit 1;

  v_j := ff_claim_waiver(v_b, v_dropped, v_b_keep, null);
  v_claim_b := (v_j->>'claim_id')::uuid;
  if v_claim_b is null then raise exception 'the claim was not filed'; end if;
  v_checks := v_checks + 1;

  -- Charlie and Delta both want the second man. Delta has the better call.
  perform ff_claim_waiver(v_c, v_second, null, null);
  perform ff_claim_waiver(v_d, v_second, null, null);
  if (select waiver_priority from teams where id = v_d) >=
     (select waiver_priority from teams where id = v_c) then
    raise exception 'the fixture does not have Delta ahead of Charlie';
  end if;
  v_checks := v_checks + 1;

  -- =========================================== Wednesday morning: the twist --
  -- SEAM: Bravo trades away the very player he named to make way, hours before
  -- waivers run. The claim was legal when it was filed and is nonsense now, and
  -- only the settlement's re-check can know that.
  v_j := ff_propose_trade(v_b, v_d, array[v_b_keep], '{}'::uuid[], 'take him', null);
  v_trade := (v_j->>'trade_id')::uuid;
  perform ff_respond_trade(v_trade, 'accepted');

  if (select o.team_id from ff_owner_at(v_league, v_week) o where o.player_id = v_b_keep) is distinct from v_d then
    raise exception 'the trade did not move the player';
  end if;
  v_checks := v_checks + 1;

  -- ==================================================== Wednesday: settlement --
  -- Age the two releases past a full week. A player clears at the next
  -- settlement AFTER he was dropped, so a drop two days old has not cleared
  -- yet and the run would correctly ignore every claim on him — which is a
  -- true rule, and would have made this rehearsal pass while proving nothing.
  -- Eight days guarantees a Wednesday has gone by. Ordering is by week and
  -- `ord`, not by the clock, so moving these does not reshuffle ownership.
  update transactions set created_at = created_at - interval '8 days'
   where league_id = v_league and kind = 'drop';

  v_j := ff_run_waivers(v_league, v_week);
  if not (v_j->>'ran')::boolean then
    raise exception 'the settlement refused to run: %', v_j->>'why';
  end if;
  v_checks := v_checks + 1;

  -- Bravo's claim is invalid, not awarded: the man he offered up is gone.
  if (select status from waiver_claims where id = v_claim_b) <> 'invalid' then
    raise exception 'a claim whose drop had been traded away settled as %',
      (select status from waiver_claims where id = v_claim_b);
  end if;
  if (select outcome from waiver_claims where id = v_claim_b) not like '%already gone%' then
    raise exception 'the invalid claim did not say why: %',
      (select outcome from waiver_claims where id = v_claim_b);
  end if;
  v_checks := v_checks + 2;

  -- And Bravo did not quietly receive the player anyway.
  if (select o.team_id from ff_owner_at(v_league, v_week) o where o.player_id = v_dropped) is not null then
    raise exception 'an invalid claim still moved the player';
  end if;
  v_checks := v_checks + 1;

  -- The contested man goes to the better call, and the loser is told.
  if (select o.team_id from ff_owner_at(v_league, v_week) o where o.player_id = v_second) is distinct from v_d then
    raise exception 'the contested claim did not go to the higher priority';
  end if;
  if (select status from waiver_claims where team_id = v_c and add_player_id = v_second) <> 'lost' then
    raise exception 'the losing claim was left as %',
      (select status from waiver_claims where team_id = v_c and add_player_id = v_second);
  end if;
  v_checks := v_checks + 2;

  -- Winning costs Delta his place at the front.
  if (select waiver_priority from teams where id = v_d) <>
     (select max(waiver_priority) from teams where league_id = v_league) then
    raise exception 'the winner did not go to the back of the queue';
  end if;
  v_checks := v_checks + 1;

  -- SEAM: a man nobody successfully claimed is not still on the wire afterwards
  -- — the settlement cleared him, so free agency owns him now.
  if exists (select 1 from ff_on_waivers(v_league) w where w.player_id = v_dropped) then
    raise exception 'an unclaimed player stayed on waivers after a settlement';
  end if;
  perform ff_add_drop(v_c, v_dropped, null, v_week);
  if (select o.team_id from ff_owner_at(v_league, v_week) o where o.player_id = v_dropped) is distinct from v_c then
    raise exception 'a cleared player could not be signed outright';
  end if;
  v_checks := v_checks + 2;

  -- ====================================================== Sunday: kickoff --
  -- One rule, three features. All of them read ff_lock_time, and all three must
  -- refuse once the ball is in the air.
  update nfl_games set kickoff_at = now() - interval '1 hour' where id = v_game;

  begin
    perform ff_add_drop(v_c, null, v_dropped, v_week);
    raise exception 'a player was dropped after kickoff';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a player was dropped after kickoff' then raise; end if;
    if v_err not like '%kicked off%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  begin
    perform ff_validate_trade(v_league, v_c, v_d, array[v_dropped], '{}'::uuid[], v_week);
    raise exception 'a player was traded after kickoff';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a player was traded after kickoff' then raise; end if;
    if v_err not like '%kicked off%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- ============================================ the invariants, after all that --
  -- Everything above was one week of four managers moving players by three
  -- different routes. These are the things that must hold regardless of route,
  -- and they are the reason this file exists.

  -- Nobody is owned twice.
  select count(*) into v_n from (
    select player_id from ff_owner_at(v_league, v_week) group by player_id having count(*) > 1) x;
  if v_n <> 0 then raise exception '% player(s) are on two rosters at once', v_n; end if;
  v_checks := v_checks + 1;

  -- Nobody is over the cap.
  select count(*) into v_n from (
    select o.team_id from ff_owner_at(v_league, v_week) o
     group by o.team_id having count(*) > 8) x;
  if v_n <> 0 then raise exception '% roster(s) finished the week over the limit', v_n; end if;
  v_checks := v_checks + 1;

  -- The cache agrees with the derivation. `rosters` is written by
  -- ff_materialize_roster on every move; ff_owner_at derives from the ledger.
  -- Two readers of the same truth, and the whole design rests on them matching.
  perform ff_ensure_week_rosters(v_league, v_week);
  select count(*) into v_n from (
    select player_id, team_id from ff_owner_at(v_league, v_week)
    except
    -- `rosters` is keyed by team, not league, so the scope comes through teams.
    select r.player_id, r.team_id from rosters r
      join teams t on t.id = r.team_id
     where t.league_id = v_league and r.week = v_week
  ) x;
  if v_n <> 0 then
    raise exception 'the roster cache disagrees with derived ownership on % player(s)', v_n;
  end if;

  select count(*) into v_n from (
    select r.player_id, r.team_id from rosters r
      join teams t on t.id = r.team_id
     where t.league_id = v_league and r.week = v_week
    except
    select player_id, team_id from ff_owner_at(v_league, v_week)
  ) x;
  if v_n <> 0 then
    raise exception 'the roster cache holds % player(s) derived ownership does not', v_n;
  end if;
  v_checks := v_checks + 2;

  -- The ledger accounts for every move, once. Six transactions happened above:
  -- two drops, a free-agent signing, a trade, a waiver award, and a signing off
  -- the cleared wire.
  v_j := ff_transactions(v_league, 200);
  if jsonb_array_length(v_j) <> 6 then
    raise exception 'the ledger shows % moves, expected 6', jsonb_array_length(v_j);
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_n from (
    select (x->>'id')::uuid as id from jsonb_array_elements(v_j) x
    group by 1 having count(*) > 1) y;
  if v_n <> 0 then raise exception 'the ledger repeated % transaction(s)', v_n; end if;
  v_checks := v_checks + 1;

  -- Every transaction the database holds reached the ledger.
  if jsonb_array_length(v_j) <> (select count(*) from transactions where league_id = v_league) then
    raise exception 'the ledger dropped a transaction the database has';
  end if;
  v_checks := v_checks + 1;

  -- The House saw the week too, once each. Both screens read everything, so if
  -- one of them is wrong about a week like this, it is wrong about every week.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_house_feed(v_league, null, 100);
  if jsonb_array_length(v_j->'items') <>
     (select count(*) from activity_events where league_id = v_league) then
    raise exception 'the House shows % items for % events',
      jsonb_array_length(v_j->'items'),
      (select count(*) from activity_events where league_id = v_league);
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_n from (
    select (x->>'id')::uuid as id from jsonb_array_elements(v_j->'items') x
    group by 1 having count(*) > 1) y;
  if v_n <> 0 then raise exception 'the House repeated % item(s)', v_n; end if;
  v_checks := v_checks + 1;

  -- It is in order, newest first. A feed that merges two tables is exactly
  -- where an ordering bug hides.
  if exists (
    select 1 from (
      select (x->>'at')::timestamptz as at,
             lag((x->>'at')::timestamptz) over () as prev
        from jsonb_array_elements(v_j->'items') with ordinality t(x, i)
    ) s where s.prev is not null and s.at > s.prev
  ) then
    raise exception 'the House is out of order';
  end if;
  v_checks := v_checks + 1;

  -- --------------------------- SEAM: the week, as three phones heard it --
  -- Bravo made an offer and had a claim go bad: accepted-your-offer, and the
  -- invalid claim. Delta received the offer and won a claim. Charlie lost one.
  -- Nobody hears about anything they did themselves.
  if (select count(*) from notification_outbox where user_id = v_uid_b) <> 2 then
    raise exception 'Bravo was told % times, expected 2 (%)',
      (select count(*) from notification_outbox where user_id = v_uid_b),
      (select string_agg(title, ' | ') from notification_outbox where user_id = v_uid_b);
  end if;
  if (select count(*) from notification_outbox where user_id = v_uid_d) <> 2 then
    raise exception 'Delta was told % times, expected 2 (%)',
      (select count(*) from notification_outbox where user_id = v_uid_d),
      (select string_agg(title, ' | ') from notification_outbox where user_id = v_uid_d);
  end if;
  if (select count(*) from notification_outbox where user_id = v_uid_c) <> 1 then
    raise exception 'Charlie was told % times, expected 1 (%)',
      (select count(*) from notification_outbox where user_id = v_uid_c),
      (select string_agg(title, ' | ') from notification_outbox where user_id = v_uid_c);
  end if;
  v_checks := v_checks + 3;

  -- Alpha did all the dropping and has no device: nothing is queued for a
  -- manager who cannot be reached, however busy his week was.
  if exists (select 1 from notification_outbox where user_id = v_uid_a) then
    raise exception 'a manager with no device had notifications queued';
  end if;
  v_checks := v_checks + 1;

  -- The one Charlie got is the one he would actually want.
  if (select title from notification_outbox where user_id = v_uid_c) not like 'You missed%' then
    raise exception 'the losing manager was told: %',
      (select title from notification_outbox where user_id = v_uid_c);
  end if;
  v_checks := v_checks + 1;

  raise notice 'season rehearsal: % checks passed', v_checks;
end $$;

rollback;
