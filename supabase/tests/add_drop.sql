-- ============================================================================
-- Add / drop, exercised against a seeded league.
--
-- Run by scripts/replay-migrations.sh --test after the 66-file replay, so it
-- runs on a database built the same way a Supabase branch builds one. Every
-- check raises on failure; a clean run prints its own tally and nothing else.
--
-- The league here is two teams and forty players so the arithmetic is checkable
-- by eye: thirty drafted, ten free, a fifteen-man cap, and one club whose game
-- has already kicked off so the lock has something to bite on.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Everything below happens inside a transaction that is rolled back at the end.
-- The test seeds a whole league; leaving it behind would make the next run
-- disagree with this one, and would put fixture rows in a database whose whole
-- point is that it is a faithful rebuild.
begin;

do $$
declare
  v_league  uuid;
  v_a       uuid;  -- team A
  v_b       uuid;  -- team B
  v_draft   uuid;
  v_week    integer := 5;
  v_free    uuid;   -- a free agent whose game has not kicked off
  v_free2   uuid;
  v_locked  uuid;   -- a free agent whose game HAS kicked off
  v_a_owned uuid;   -- a player on team A, not kicked off
  v_a_lock  uuid;   -- a player on team A whose game HAS kicked off
  v_b_owned uuid;
  v_n       integer;
  v_j       jsonb;
  v_err     text;
  v_owner   uuid;
  v_uid     uuid;
  v_checks  integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values
    ('AAA','Alpha','AAA'), ('BBB','Beta','BBB'), ('CCC','Gamma','CCC')
  on conflict (id) do nothing;

  -- Alpha and Beta play late; Gamma kicked off an hour ago.
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at)
  values ('t-ab', 2026, 2, v_week, 'AAA', 'BBB', now() + interval '2 days'),
         ('t-cc', 2026, 2, v_week, 'CCC', 'AAA', now() - interval '1 hour');

  insert into leagues (name, season, team_count, roster_slots)
  values ('Test League', 2026, 2,
          '["QB","RB","RB","WR","WR","TE","FLEX","K","DST","BN","BN","BN","BN","BN","BN"]'::jsonb)
  returning id into v_league;

  insert into teams (league_id, name) values (v_league, 'Team A') returning id into v_a;
  insert into teams (league_id, name) values (v_league, 'Team B') returning id into v_b;

  -- 40 players: 36 on the two clubs that play late, 4 on the club already playing.
  -- sleeper_id is not decoration: `draft_pool`, and therefore the free agent
  -- list and the add check, only see players the loader has matched.
  insert into players (full_name, position, nfl_team, status, sleeper_id)
  select 'Player ' || lpad(g::text, 2, '0'),
         (array['QB','RB','WR','TE','K','DST'])[1 + (g % 6)],
         case when g > 36 then 'CCC' when g % 2 = 0 then 'AAA' else 'BBB' end,
         'ACT', 'test-' || g
    from generate_series(1, 40) g;

  insert into drafts (league_id, rounds) values (v_league, 15) returning id into v_draft;

  -- An owner for team A, so the authenticated paths can be exercised for real
  -- rather than only through the service-role hatch.
  insert into auth.users (email) values ('a@example.test') returning id into v_uid;
  update teams set owner_id = v_uid where id = v_a;

  -- 15 to A, 15 to B, in player order; 10 left in the pool.
  -- `20260809021720` already seeded 32 team defences, and they sort ahead of
  -- these. Every fixture query below says "my players" for that reason.
  insert into draft_picks (draft_id, pick_number, round, team_id, player_id)
  select v_draft, row_number() over (order by p.full_name),
         1 + ((row_number() over (order by p.full_name) - 1) / 2)::int,
         case when row_number() over (order by p.full_name) % 2 = 1 then v_a else v_b end,
         p.id
    from (select id, full_name from players
           where sleeper_id like 'test-%' order by full_name limit 30) p;

  select dp.player_id into v_a_owned
    from draft_picks dp join players p on p.id = dp.player_id
   where dp.team_id = v_a and p.nfl_team <> 'CCC' and p.sleeper_id like 'test-%' limit 1;
  select dp.player_id into v_b_owned from draft_picks dp where dp.team_id = v_b limit 1;

  select p.id into v_free from players p
   where p.sleeper_id like 'test-%' and p.nfl_team <> 'CCC'
     and not exists (select 1 from draft_picks dp where dp.player_id = p.id) limit 1;
  select p.id into v_free2 from players p
   where p.sleeper_id like 'test-%' and p.nfl_team <> 'CCC' and p.id <> v_free
     and not exists (select 1 from draft_picks dp where dp.player_id = p.id) limit 1;
  select p.id into v_locked from players p
   where p.sleeper_id like 'test-%' and p.nfl_team = 'CCC'
     and not exists (select 1 from draft_picks dp where dp.player_id = p.id) limit 1;

  if v_free is null or v_free2 is null or v_locked is null or v_a_owned is null then
    raise exception 'fixture is wrong: free=% free2=% locked=% a_owned=%',
      v_free, v_free2, v_locked, v_a_owned;
  end if;

  -- ------------------------------------------------ no signings mid-draft --
  -- The draft is still 'setup'. Free agency during a draft lets a manager sign
  -- a player another team can still draft, and ff_owner_at then hands him to
  -- the signer — the drafting team loses the pick it spent.
  -- A swap, not a bare add: cap-neutral, so the draft check is the only thing
  -- that can refuse it. A bare add would trip the roster cap first and the test
  -- would pass for the wrong reason.
  begin
    perform ff_add_drop(v_a, v_free, v_a_owned, v_week);
    raise exception 'a signing was allowed before the draft finished';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%draft is not finished%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  update drafts set status = 'complete' where id = v_draft;

  -- ------------------------------------------------- ownership before a move --
  select count(*) into v_n from ff_owner_at(v_league, v_week);
  if v_n <> 30 then raise exception 'expected 30 owned before any move, got %', v_n; end if;
  v_checks := v_checks + 1;

  select count(*) into v_n from ff_owner_at(v_league, v_week) where team_id = v_a;
  if v_n <> 15 then raise exception 'expected 15 on team A, got %', v_n; end if;
  v_checks := v_checks + 1;

  -- A drafted player nobody has moved is owned by the team that drafted him.
  select team_id into v_owner from ff_owner_at(v_league, v_week) where player_id = v_a_owned;
  if v_owner <> v_a then raise exception 'drafted player is not on his drafting team'; end if;
  v_checks := v_checks + 1;

  -- The pool is everyone else.
  if (select jsonb_array_length(ff_free_agents(v_league, v_week))) <> 10 then
    raise exception 'expected 10 free agents, got %',
      (select jsonb_array_length(ff_free_agents(v_league, v_week)));
  end if;
  v_checks := v_checks + 1;

  -- The map the players page and the drop picker both read.
  v_j := ff_pool_owners(v_league, v_week);
  if jsonb_array_length(v_j) <> 30 then
    raise exception 'ff_pool_owners returned %, expected 30', jsonb_array_length(v_j);
  end if;
  if (select count(*) from jsonb_array_elements(v_j) e
       where e->>'team' is null or e->>'player' is null) > 0 then
    raise exception 'ff_pool_owners left a team or player name null';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------ the cap bites --
  -- Team A is full at 15. A bare add must be refused.
  begin
    perform ff_add_drop(v_a, v_free, null, v_week);
    raise exception 'a bare add onto a full roster was allowed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%roster is full%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- add and drop together --
  v_j := ff_add_drop(v_a, v_free, v_a_owned, v_week);
  if v_j->>'kind' <> 'add_drop' then raise exception 'kind was %', v_j->>'kind'; end if;
  if (v_j->>'roster_size')::int <> 15 then
    raise exception 'roster size after a swap was %', v_j->>'roster_size';
  end if;
  v_checks := v_checks + 1;

  -- The per-league serialization is engaged. A single session cannot prove it
  -- prevents the race — that needs two connections — but it can prove the lock
  -- is actually taken, so nobody removes it later without this going red.
  if not exists (select 1 from pg_locks
                  where locktype = 'advisory' and pid = pg_backend_pid()) then
    raise exception 'ff_add_drop did not take the per-league advisory lock';
  end if;
  v_checks := v_checks + 1;

  -- Ownership moved, both ways.
  if (select team_id from ff_owner_at(v_league, v_week) where player_id = v_free) <> v_a then
    raise exception 'the added player is not on team A';
  end if;
  if exists (select 1 from ff_owner_at(v_league, v_week) where player_id = v_a_owned) then
    raise exception 'the dropped player is still owned';
  end if;
  v_checks := v_checks + 1;

  -- The cache agrees with the derivation.
  select count(*) into v_n from rosters where team_id = v_a and week = v_week;
  if v_n <> 15 then raise exception 'rosters has % rows for team A, expected 15', v_n; end if;
  if exists (select 1 from rosters where team_id = v_a and week = v_week and player_id = v_a_owned) then
    raise exception 'the dropped player is still in the roster cache';
  end if;
  if not exists (select 1 from rosters where team_id = v_a and week = v_week and player_id = v_free) then
    raise exception 'the added player never reached the roster cache';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------ what is refused --
  -- Somebody else's player.
  begin
    perform ff_add_drop(v_a, null, v_b_owned, v_week);
    raise exception 'dropping another team''s player was allowed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%do not own%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- Somebody already rostered.
  begin
    perform ff_add_drop(v_a, v_b_owned, v_free, v_week);
    raise exception 'adding a rostered player was allowed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%already on a roster%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- A man whose game has kicked off cannot be picked up.
  begin
    perform ff_add_drop(v_a, v_locked, v_free, v_week);
    raise exception 'adding a player mid-game was allowed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%kicked off%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- Nor can one be dropped once he is playing.
  select dp.player_id into v_a_lock
    from draft_picks dp join players p on p.id = dp.player_id
   where dp.team_id = v_a and p.nfl_team = 'CCC' limit 1;
  if v_a_lock is not null then
    begin
      perform ff_add_drop(v_a, null, v_a_lock, v_week);
      raise exception 'dropping a player mid-game was allowed';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%kicked off%' then raise; end if;
    end;
    v_checks := v_checks + 1;
  end if;

  -- Naming nobody, and naming the same man twice.
  begin
    perform ff_add_drop(v_a, null, null, v_week);
    raise exception 'an empty move was allowed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%nothing to do%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  begin
    perform ff_add_drop(v_a, v_free2, v_free2, v_week);
    raise exception 'adding and dropping the same player was allowed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%same player%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- a bare drop, and room --
  perform ff_add_drop(v_a, null, v_free, v_week);
  select count(*) into v_n from ff_owner_at(v_league, v_week) where team_id = v_a;
  if v_n <> 14 then raise exception 'after a bare drop team A has %, expected 14', v_n; end if;
  v_checks := v_checks + 1;

  -- With room, a bare add is fine — and a player dropped earlier can be re-signed,
  -- which is the case that a naive "has he ever been dropped" rule gets wrong.
  perform ff_add_drop(v_a, v_a_owned, null, v_week);
  if (select team_id from ff_owner_at(v_league, v_week) where player_id = v_a_owned) <> v_a then
    raise exception 're-signing a previously dropped player did not stick';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------- history is real --
  -- Ownership as of an EARLIER week must be unchanged by moves made in week 5.
  if (select team_id from ff_owner_at(v_league, v_week - 1) where player_id = v_a_owned) <> v_a
     or exists (select 1 from ff_owner_at(v_league, v_week - 1) where player_id = v_free) then
    raise exception 'a week-5 move leaked backwards into week 4';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- the week rolls forward --
  -- Week 6 has no rows. Materializing it inherits week 5's slots for the men
  -- still owned, so a manager who set a lineup does not come back to a bench.
  update rosters set slot = 'QB'
   where team_id = v_a and week = v_week
     and player_id = (select player_id from rosters
                       where team_id = v_a and week = v_week order by player_id limit 1);

  perform ff_ensure_week_rosters(v_league, v_week + 1);
  select count(*) into v_n from rosters where team_id = v_a and week = v_week + 1;
  if v_n <> 15 then raise exception 'week 6 has % rows for team A, expected 15', v_n; end if;
  if not exists (select 1 from rosters where team_id = v_a and week = v_week + 1 and slot = 'QB') then
    raise exception 'week 6 did not inherit week 5''s lineup';
  end if;
  v_checks := v_checks + 1;

  -- The map follows a move: the picker must not offer a man already gone.
  v_j := ff_pool_owners(v_league, v_week);
  if exists (select 1 from jsonb_array_elements(v_j) e
              where (e->>'player_id')::uuid = v_free) then
    raise exception 'ff_pool_owners still lists a released player as owned';
  end if;
  v_checks := v_checks + 1;

  -- A league with nothing to derive from must not have its rosters deleted.
  -- This is the state production sits in all preseason, and it is the one where
  -- a daily roll-forward could quietly empty every team.
  declare
    v_empty uuid;
    v_et    uuid;
  begin
    insert into leagues (name, season, team_count, roster_slots)
    values ('Undrafted', 2026, 1, '["QB","BN"]'::jsonb) returning id into v_empty;
    insert into teams (league_id, name) values (v_empty, 'Nobody') returning id into v_et;
    insert into rosters (team_id, player_id, week, slot)
      select v_et, id, v_week, 'BN' from players where sleeper_id like 'test-%' limit 2;

    perform ff_ensure_week_rosters(v_empty, v_week);

    if (select count(*) from rosters where team_id = v_et and week = v_week) <> 2 then
      raise exception 'the roll-forward emptied a league that has not drafted';
    end if;
  end;
  v_checks := v_checks + 1;

  -- ------------------------------------------- what an authenticated manager may do --
  -- auth.uid() reads the request's JWT claims, so setting them here exercises
  -- the real owner and week checks rather than the service-role hatch.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

    -- The week is not the caller's to choose: ff_owner_at orders by week before
    -- ord, so a claim filed for a future week would override every legitimate
    -- move made in between once that week arrived.
    begin
      perform ff_add_drop(v_a, v_free2, null, 25);
      raise exception 'a manager was allowed to file a move for a future week';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%current week%' then raise; end if;
    end;

    -- And somebody else's team stays somebody else's.
    begin
      perform ff_add_drop(v_b, v_free2, null, null);
      raise exception 'a manager was allowed to move another team''s roster';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%not your team%' then raise; end if;
    end;

    perform set_config('request.jwt.claims', '', true);
  end;
  v_checks := v_checks + 2;

  -- ----------------------------------------------------------- the ledger --
  v_j := ff_transactions(v_league, 50);
  -- Three moves succeeded: the swap, the bare drop, the bare re-signing. The
  -- refused ones must leave nothing behind, which is half of what this counts.
  if jsonb_array_length(v_j) <> 3 then
    raise exception 'expected 3 logged transactions, got %', jsonb_array_length(v_j);
  end if;
  if jsonb_array_length(v_j->0->'items') < 1 then
    raise exception 'a logged transaction has no items';
  end if;
  v_checks := v_checks + 1;

  -- And the feed saw them.
  select count(*) into v_n from activity_events
   where league_id = v_league and event_type = 'transaction';
  if v_n <> 3 then raise exception 'expected 3 feed entries, got %', v_n; end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- a reset forgets both --
  -- Resetting deletes the picks; leaving the moves behind would let an old
  -- transaction outrank the new draft, so a redrafted player never arrives.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  update leagues set commissioner_id = v_uid where id = v_league;
  perform ff_reset_draft(v_draft);
  perform set_config('request.jwt.claims', '', true);

  if exists (select 1 from transactions where league_id = v_league) then
    raise exception 'a draft reset left the league''s moves behind';
  end if;
  if exists (select 1 from rosters r join teams t on t.id = r.team_id
              where t.league_id = v_league) then
    raise exception 'a draft reset left the derived roster cache behind';
  end if;
  v_checks := v_checks + 1;

  raise notice 'add/drop: % checks passed', v_checks;
end $$;

rollback;
