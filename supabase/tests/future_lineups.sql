-- ============================================================================
-- Setting a lineup for a week that has not come yet.
--
-- Run by scripts/replay-migrations.sh --test. Every check raises on failure.
-- Rolled back at the end.
--
-- Two teams, thirty drafted players, a game for every club in every week from
-- tomorrow on so nothing is locked. "Now" is whatever ff_current_week says once
-- the fixture is in; every week below is named relative to it.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_a      uuid;
  v_b      uuid;
  v_draft  uuid;
  v_now    integer;
  v_x      uuid;   -- team A's running back
  v_y      uuid;   -- team A, dropped ahead of time
  v_b_pl   uuid;   -- team B's
  v_tx     uuid;
  v_n      integer;
  v_slot   text;
  v_hub    jsonb;
  v_err    text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values
    ('FLA','Fl Alpha','FLA'), ('FLB','Fl Beta','FLB')
  on conflict (id) do nothing;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at)
  select 'fl-' || w, 2026, 2, w, 'FLA', 'FLB', now() + make_interval(days => w)
    from generate_series(1, 18) w;

  insert into leagues (name, season, team_count, roster_slots)
  values ('Future League', 2026, 2,
          '["QB","RB","RB","WR","WR","TE","FLEX","K","DST","BN","BN","BN","BN","BN","BN"]'::jsonb)
  returning id into v_league;
  insert into teams (league_id, name) values (v_league, 'Team A') returning id into v_a;
  insert into teams (league_id, name) values (v_league, 'Team B') returning id into v_b;

  insert into players (full_name, position, nfl_team, status, sleeper_id)
  select 'Future ' || lpad(g::text, 2, '0'),
         (array['QB','RB','WR','TE','K','DST'])[1 + (g % 6)],
         case when g % 2 = 0 then 'FLA' else 'FLB' end,
         'ACT', 'fl-' || g
    from generate_series(1, 30) g;

  insert into drafts (league_id, rounds, status) values (v_league, 15, 'complete')
  returning id into v_draft;
  insert into draft_picks (draft_id, pick_number, round, team_id, player_id)
  select v_draft, row_number() over (order by p.full_name),
         1 + ((row_number() over (order by p.full_name) - 1) / 2)::int,
         case when row_number() over (order by p.full_name) % 2 = 1 then v_a else v_b end,
         p.id
    from (select id, full_name from players where sleeper_id like 'fl-%' order by full_name) p;

  v_now := ff_current_week();
  if v_now > 14 then raise exception 'fixture is wrong: current week is %', v_now; end if;

  select dp.player_id into v_x from draft_picks dp join players p on p.id = dp.player_id
   where dp.team_id = v_a and p.position = 'RB' limit 1;
  select dp.player_id into v_y from draft_picks dp join players p on p.id = dp.player_id
   where dp.team_id = v_a and p.position = 'TE' limit 1;
  select dp.player_id into v_b_pl from draft_picks dp where dp.team_id = v_b limit 1;

  -- This week: rolled, and the running back started.
  perform ff_ensure_week_rosters(v_league, v_now);
  perform ff_set_lineup(v_a, v_now, jsonb_build_object(v_x, 'RB'));

  -- ------------------------------------------- looking ahead writes nothing --
  v_hub := ff_team_hub(v_a, v_now + 2);
  if jsonb_array_length(v_hub->'roster') <> 15 then
    raise exception 'week +2 hub drew % players, expected 15', jsonb_array_length(v_hub->'roster');
  end if;
  v_checks := v_checks + 1;

  select e->>'slot' into v_slot from jsonb_array_elements(v_hub->'roster') e
   where (e->>'player_id')::uuid = v_x;
  if v_slot is distinct from 'RB' then
    raise exception 'week +2 should inherit this week''s RB, drew %', v_slot;
  end if;
  v_checks := v_checks + 1;

  if exists (select 1 from rosters where team_id = v_a and week > v_now) then
    raise exception 'opening a future week wrote rosters rows';
  end if;
  v_checks := v_checks + 1;

  -- -------------------------------------------------- setting it ahead --
  v_n := ff_set_lineup(v_a, v_now + 2, jsonb_build_object(v_x, 'BN'));
  if v_n <> 1 then raise exception 'ff_set_lineup ahead returned %', v_n; end if;
  if (select slot from rosters where team_id = v_a and week = v_now + 2 and player_id = v_x) <> 'BN' then
    raise exception 'the week +2 move did not land';
  end if;
  if (select count(*) from rosters where team_id = v_a and week = v_now + 2) <> 15 then
    raise exception 'week +2 was not materialized whole';
  end if;
  v_checks := v_checks + 1;

  -- This week is untouched, and the week in between still follows this week.
  if (select slot from rosters where team_id = v_a and week = v_now and player_id = v_x) <> 'RB' then
    raise exception 'a move ahead changed this week';
  end if;
  select e->>'slot' into v_slot from jsonb_array_elements(ff_team_hub(v_a, v_now + 1)->'roster') e
   where (e->>'player_id')::uuid = v_x;
  if v_slot is distinct from 'RB' then
    raise exception 'week +1 should still follow this week, drew %', v_slot;
  end if;
  v_checks := v_checks + 1;

  -- And the hub for the week that was set shows what was set.
  select e->>'slot' into v_slot from jsonb_array_elements(ff_team_hub(v_a, v_now + 2)->'roster') e
   where (e->>'player_id')::uuid = v_x;
  if v_slot is distinct from 'BN' then
    raise exception 'week +2 hub drew % after it was set to BN', v_slot;
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------- nobody else's player, silently --
  begin
    perform ff_set_lineup(v_a, v_now + 2, jsonb_build_object(v_b_pl, 'BN'));
    raise exception 'a player on another roster was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%not on this roster%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ------------------------------------- a move since the week was written --
  insert into transactions (league_id, kind, week) values (v_league, 'drop', v_now + 1)
  returning id into v_tx;
  insert into transaction_items (transaction_id, player_id, from_team_id) values (v_tx, v_y, v_a);

  if exists (select 1 from jsonb_array_elements(ff_team_hub(v_a, v_now + 2)->'roster') e
              where (e->>'player_id')::uuid = v_y) then
    raise exception 'week +2 hub still draws a player dropped before it';
  end if;
  v_checks := v_checks + 1;

  perform ff_set_lineup(v_a, v_now + 2, jsonb_build_object(v_x, 'RB'));
  if exists (select 1 from rosters where team_id = v_a and week = v_now + 2 and player_id = v_y) then
    raise exception 'setting week +2 left the dropped player in its rows';
  end if;
  perform ff_set_lineup(v_a, v_now + 2, jsonb_build_object(v_x, 'BN'));
  v_checks := v_checks + 1;

  -- ------------------------------------------------------- inheritance --
  -- Week +3 starts from the plan in week +2, the latest one before it.
  perform ff_materialize_roster(v_a, v_now + 3);
  if (select slot from rosters where team_id = v_a and week = v_now + 3 and player_id = v_x) <> 'BN' then
    raise exception 'week +3 did not inherit week +2''s plan';
  end if;
  v_checks := v_checks + 1;

  -- Week +1, filled in late, still starts from this week.
  perform ff_materialize_roster(v_a, v_now + 1);
  if (select slot from rosters where team_id = v_a and week = v_now + 1 and player_id = v_x) <> 'RB' then
    raise exception 'week +1 did not inherit this week''s lineup';
  end if;
  v_checks := v_checks + 1;

  raise notice 'future_lineups: % checks passed', v_checks;
end $$;

rollback;
