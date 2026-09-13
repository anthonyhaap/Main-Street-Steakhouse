-- ============================================================================
-- The last pick builds the rosters.
--
-- The night the league drafted, every team page was empty until a cron seven
-- hours away: `rosters` is a cache, and nothing wrote it when the board filled.
-- This drives a two-team, four-round draft through ff_make_pick — the real
-- entry point for a manager's pick and for autopick alike — and checks that the
-- cache is untouched while the draft runs, appears in full on the final pick,
-- comes with an opening lineup that prefers projection and avoids the bye, and
-- follows the board when the commissioner undoes and remakes the last pick
-- without reshuffling a lineup a manager has already set.
--
-- Deliberately no jwt claims: auth.uid() null is the service-role path the tick
-- worker uses, and the authorisation rules for picking have their own coverage.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_draft uuid; v_a uuid; v_b uuid;
  v_week integer;
  qb_a uuid; qb_b uuid; rb_a1 uuid; rb_a2 uuid; rb_b1 uuid; rb_b2 uuid; wr_a uuid; wr_b uuid;
  v_slot text; v_status text; v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  v_week := greatest(1, ff_current_week());

  insert into nfl_teams (id, name, espn_id) values ('DCT','Draft Complete','DCT')
    on conflict (id) do nothing;

  insert into leagues (name, season, team_count, roster_slots, settings)
  values ('Last Pick', 2026, 2, '["QB","RB","BN","BN"]'::jsonb, '{}'::jsonb)
  returning id into v_league;

  insert into teams (league_id, name, draft_slot) values (v_league, 'Alpha', 1) returning id into v_a;
  insert into teams (league_id, name, draft_slot) values (v_league, 'Bravo', 2) returning id into v_b;

  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC QB Alpha',  'QB', 'DCT', 'ACT', 'dct-1') returning id into qb_a;
  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC QB Bravo',  'QB', 'DCT', 'ACT', 'dct-2') returning id into qb_b;
  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC RB Alpha 1','RB', 'DCT', 'ACT', 'dct-3') returning id into rb_a1;
  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC RB Alpha 2','RB', 'DCT', 'ACT', 'dct-4') returning id into rb_a2;
  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC RB Bravo 1','RB', 'DCT', 'ACT', 'dct-5') returning id into rb_b1;
  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC RB Bravo 2','RB', 'DCT', 'ACT', 'dct-6') returning id into rb_b2;
  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC WR Alpha',  'WR', 'DCT', 'ACT', 'dct-7') returning id into wr_a;
  insert into players (full_name, position, nfl_team, status, sleeper_id) values ('DC WR Bravo',  'WR', 'DCT', 'ACT', 'dct-8') returning id into wr_b;

  -- Alpha's second back projects higher than his first, so the opening lineup
  -- has to read the projection rather than the pick order to get him right.
  insert into player_season_projections (player_id, season, points_total) values (rb_a1, 2026, 100);
  insert into player_season_projections (player_id, season, points_total) values (rb_a2, 2026, 150);
  -- Bravo's best back is on bye this week; the lesser one should start.
  insert into player_season_projections (player_id, season, points_total) values (rb_b1, 2026, 200);
  insert into player_season_projections (player_id, season, points_total) values (rb_b2, 2026, 50);
  update players set bye_week = v_week where id = rb_b1;

  insert into drafts (league_id, rounds, status, pick_seconds, pick_deadline)
  values (v_league, 4, 'active', 90, now() + interval '90 seconds')
  returning id into v_draft;

  -- ------------------------------------------------------------ the draft --
  -- Snake, two seats: A B | B A | A B | B A.
  perform ff_make_pick(v_draft, qb_a);
  perform ff_make_pick(v_draft, qb_b);
  perform ff_make_pick(v_draft, rb_b1);
  perform ff_make_pick(v_draft, rb_a1);
  perform ff_make_pick(v_draft, rb_a2);
  perform ff_make_pick(v_draft, rb_b2);
  perform ff_make_pick(v_draft, wr_b);

  -- Seven of eight picks in, the cache does not exist. The draft room reads
  -- the board, and a roster that appears mid-draft would be one that has to
  -- be kept in step with every pick.
  if exists (select 1 from rosters r join teams t on t.id = r.team_id where t.league_id = v_league) then
    raise exception 'rosters were written before the draft finished';
  end if;
  v_checks := v_checks + 1;

  -- The last pick.
  perform ff_make_pick(v_draft, wr_a);

  select status::text into v_status from drafts where id = v_draft;
  if v_status <> 'complete' then
    raise exception 'eight picks of eight did not complete the draft: %', v_status;
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------- every roster --
  select count(*) into v_n from rosters where team_id = v_a and week = v_week;
  if v_n <> 4 then raise exception 'Alpha has % roster rows after the draft, expected 4', v_n; end if;
  select count(*) into v_n from rosters where team_id = v_b and week = v_week;
  if v_n <> 4 then raise exception 'Bravo has % roster rows after the draft, expected 4', v_n; end if;
  v_checks := v_checks + 1;

  -- Nothing leaked into another week.
  if exists (select 1 from rosters r join teams t on t.id = r.team_id
              where t.league_id = v_league and r.week <> v_week) then
    raise exception 'the draft wrote rosters for a week other than the current one';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------- the opening lineup --
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = qb_a;
  if v_slot <> 'QB' then raise exception 'Alpha''s quarterback opened in %', v_slot; end if;
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = rb_a2;
  if v_slot <> 'RB' then raise exception 'Alpha''s higher-projected back opened in %, not RB', v_slot; end if;
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = rb_a1;
  if v_slot <> 'BN' then raise exception 'Alpha''s lesser back opened in %, not BN', v_slot; end if;
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = wr_a;
  if v_slot <> 'BN' then raise exception 'a receiver in a league with no WR slot opened in %', v_slot; end if;
  v_checks := v_checks + 1;

  select slot into v_slot from rosters where team_id = v_b and week = v_week and player_id = rb_b2;
  if v_slot <> 'RB' then raise exception 'Bravo''s back who is not on bye opened in %, not RB', v_slot; end if;
  select slot into v_slot from rosters where team_id = v_b and week = v_week and player_id = rb_b1;
  if v_slot <> 'BN' then raise exception 'Bravo''s back on bye opened in %, not BN', v_slot; end if;
  v_checks := v_checks + 1;

  -- Everybody who reads ownership agrees with the cache.
  if exists (
    select 1 from ff_owner_at(v_league, v_week) o
    full outer join (select r.player_id, r.team_id from rosters r join teams t on t.id = r.team_id
                      where t.league_id = v_league and r.week = v_week) c
      on c.player_id = o.player_id and c.team_id = o.team_id
    where o.player_id is null or c.player_id is null
  ) then
    raise exception 'ff_owner_at and rosters disagree after the draft';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- undo, and pick again --
  -- Alpha sets a lineup of his own first: the lesser back starts.
  perform ff_set_lineup(v_a, v_week, jsonb_build_object(rb_a1::text, 'RB', rb_a2::text, 'BN'));

  -- The commissioner takes the last pick back. Alpha's receiver leaves the
  -- board, so he leaves the roster too.
  perform ff_undo_last_pick(v_draft);
  select status::text into v_status from drafts where id = v_draft;
  if v_status <> 'paused' then raise exception 'undo out of a complete draft left it %', v_status; end if;
  if exists (select 1 from rosters where team_id = v_a and week = v_week and player_id = wr_a) then
    raise exception 'the undone pick is still on the roster';
  end if;
  select count(*) into v_n from rosters where team_id = v_a and week = v_week;
  if v_n <> 3 then raise exception 'Alpha has % roster rows after the undo, expected 3', v_n; end if;
  v_checks := v_checks + 1;

  -- And makes it again. The board is full a second time; the receiver is back,
  -- on the bench, and Alpha's own lineup is exactly as he left it.
  perform ff_resume_draft(v_draft);
  perform ff_make_pick(v_draft, wr_a);

  select status::text into v_status from drafts where id = v_draft;
  if v_status <> 'complete' then raise exception 'remaking the last pick left the draft %', v_status; end if;
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = wr_a;
  if v_slot is distinct from 'BN' then raise exception 'the remade pick came back in % rather than BN', coalesce(v_slot, 'nowhere'); end if;
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = rb_a1;
  if v_slot <> 'RB' then raise exception 'a lineup the manager set was reshuffled: his back is in %', v_slot; end if;
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = rb_a2;
  if v_slot <> 'BN' then raise exception 'a lineup the manager set was reshuffled: his bench back is in %', v_slot; end if;
  v_checks := v_checks + 1;

  -- Running it again by hand changes nothing.
  v_n := ff_rosters_after_draft(v_league);
  if v_n <> 8 then raise exception 'a second run reported % roster rows, expected 8', v_n; end if;
  select slot into v_slot from rosters where team_id = v_a and week = v_week and player_id = rb_a1;
  if v_slot <> 'RB' then raise exception 'a second run reshuffled a set lineup'; end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may run it --
  -- Reached only from inside the pick and the undo. A manager who could call it
  -- could set another team's opening lineup.
  if has_function_privilege('anon', 'public.ff_rosters_after_draft(uuid,integer)', 'execute')
  or has_function_privilege('authenticated', 'public.ff_rosters_after_draft(uuid,integer)', 'execute') then
    raise exception 'ff_rosters_after_draft is callable from the browser';
  end if;
  v_checks := v_checks + 1;

  raise notice 'draft complete: % checks passed', v_checks;
end $$;

rollback;
