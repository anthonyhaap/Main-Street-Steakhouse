-- ============================================================================
-- The scoreboard's bench: present, and inert.
--
-- `20260921004635_scoreboard_carries_the_bench` stopped filtering `slot <> 'BN'`
-- in `ff_scoreboard`'s join and moved the filter onto every aggregate instead.
-- That is a small edit with one large failure mode: a bench player who leaks
-- into a total moves a score, a projection, a win probability or a
-- lineup-hole warning on the Sunday board, and nothing on the screen would say
-- he had.
--
-- So this builds one week where the bench is deliberately louder than the
-- starters — the highest-scoring player on the roster is sitting, his game is
-- the only one still in progress, and both sides carry more bench than
-- starters — and checks that not one number on either side moved.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_uid uuid; v_home uuid; v_away uuid;
  v_done uuid; v_onnow uuid;            -- one game final, one in progress
  v_qb uuid; v_rb uuid; v_wr uuid;      -- the home starters
  v_bq uuid; v_br uuid;                 -- the home bench
  v_aqb uuid; v_ab uuid;                -- the away starter and his bench
  v_rules jsonb;
  v_j jsonb; v_h jsonb; v_a jsonb;
  v_expect numeric; v_bench_pts numeric; v_top_pts numeric;
  v_checks integer := 0;
  v_week constant integer := 5;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into nfl_teams (id, name, espn_id) values
    ('AAA','Alphas','AAA'), ('BBB','Betas','BBB'),
    ('CCC','Gammas','CCC'), ('DDD','Deltas','DDD')
  on conflict (id) do nothing;

  -- Every starter plays in the game that is already over; every bench player
  -- plays in the one that is still on. That inverts the usual reading, which
  -- is the point: `yet_to_play` and `in_action` must come back zero.
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail)
  values ('sb-done', 2026, 2, v_week, 'AAA', 'BBB', now() - interval '4 hours', 'post', 'Final')
  returning id into v_done;
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail)
  values ('sb-on', 2026, 2, v_week, 'CCC', 'DDD', now() - interval '30 minutes', 'in', 'Q2 8:41')
  returning id into v_onnow;

  insert into auth.users (email) values ('sb@example.test') returning id into v_uid;
  insert into leagues (name, season, team_count, commissioner_id, roster_slots, settings)
  values ('Scoreboard Test', 2026, 2, v_uid,
          '["QB","RB","WR","BN","BN"]'::jsonb, '{}'::jsonb)
  returning id into v_league;

  -- Standard PPR, enough of it to make the numbers below differ from each
  -- other. `ff_rules_for_week` reads this table and `ff_score` returns zero
  -- without it, which would pass every assertion in this file vacuously.
  insert into league_scoring_rules (league_id, effective_from_week, rules)
  values (v_league, 1, '{"pass_yd":0.04,"pass_td":4,"pass_int":-2,
                         "rush_yd":0.1,"rush_td":6,"rec":1,"rec_yd":0.1,"rec_td":6}'::jsonb);

  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Alpha', 'Ada', v_uid) returning id into v_home;
  insert into teams (league_id, name, manager_name)
  values (v_league, 'Bravo', 'Bo') returning id into v_away;

  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points)
  values (v_league, v_week, v_home, v_away, 41.5, 12.25);

  insert into players (full_name, position, nfl_team) values ('Starting Quarterback','QB','AAA') returning id into v_qb;
  insert into players (full_name, position, nfl_team) values ('Starting Runner','RB','AAA')       returning id into v_rb;
  insert into players (full_name, position, nfl_team) values ('Starting Receiver','WR','AAA')     returning id into v_wr;
  -- The loudest man on the roster, and he is sitting.
  insert into players (full_name, position, nfl_team) values ('Benched Quarterback','QB','CCC')   returning id into v_bq;
  insert into players (full_name, position, nfl_team) values ('Benched Runner','RB','CCC')        returning id into v_br;
  insert into players (full_name, position, nfl_team) values ('Away Quarterback','QB','BBB')      returning id into v_aqb;
  insert into players (full_name, position, nfl_team) values ('Away Benchwarmer','RB','DDD')      returning id into v_ab;

  insert into rosters (team_id, player_id, week, slot) values
    (v_home, v_qb, v_week, 'QB'), (v_home, v_rb, v_week, 'RB'), (v_home, v_wr, v_week, 'WR'),
    (v_home, v_bq, v_week, 'BN'), (v_home, v_br, v_week, 'BN'),
    -- Bravo starts one man of three and benches one. Its two empty slots must
    -- survive the bench row sitting in the same join.
    (v_away, v_aqb, v_week, 'QB'), (v_away, v_ab, v_week, 'BN');

  insert into player_stat_lines (player_id, game_id, season, season_type, week, source, stats) values
    (v_qb,  v_done,  2026, 2, v_week, 'sleeper', '{"pass_yd":240,"pass_td":1}'::jsonb),
    (v_rb,  v_done,  2026, 2, v_week, 'sleeper', '{"rush_yd":60,"rush_td":1}'::jsonb),
    (v_wr,  v_done,  2026, 2, v_week, 'sleeper', '{"rec":5,"rec_yd":70}'::jsonb),
    -- Five hundred yards and six touchdowns, from the bench.
    (v_bq,  v_onnow, 2026, 2, v_week, 'sleeper', '{"pass_yd":500,"pass_td":6}'::jsonb),
    (v_br,  v_onnow, 2026, 2, v_week, 'sleeper', '{"rush_yd":140,"rush_td":2}'::jsonb),
    (v_aqb, v_done,  2026, 2, v_week, 'sleeper', '{"pass_yd":150}'::jsonb),
    (v_ab,  v_onnow, 2026, 2, v_week, 'sleeper', '{"rush_yd":200,"rush_td":3}'::jsonb);

  insert into player_projections (player_id, season, season_type, week, source, stats) values
    (v_qb,  2026, 2, v_week, 'sleeper', '{"pass_yd":250,"pass_td":2}'::jsonb),
    (v_rb,  2026, 2, v_week, 'sleeper', '{"rush_yd":70,"rush_td":1}'::jsonb),
    (v_wr,  2026, 2, v_week, 'sleeper', '{"rec":6,"rec_yd":80}'::jsonb),
    (v_bq,  2026, 2, v_week, 'sleeper', '{"pass_yd":400,"pass_td":4}'::jsonb),
    (v_br,  2026, 2, v_week, 'sleeper', '{"rush_yd":120,"rush_td":2}'::jsonb),
    (v_aqb, 2026, 2, v_week, 'sleeper', '{"pass_yd":200,"pass_td":1}'::jsonb),
    (v_ab,  2026, 2, v_week, 'sleeper', '{"rush_yd":150,"rush_td":2}'::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  v_rules := ff_rules_for_week(v_league, v_week);
  v_j := ff_scoreboard(v_league, v_week);
  v_h := v_j->'matchups'->0->'home';
  v_a := v_j->'matchups'->0->'away';

  if v_h->>'name' <> 'Alpha' then
    raise exception 'the home side is %, so the rest of this file is reading the wrong team', v_h->>'name';
  end if;

  -- The premise, checked rather than assumed: if the bench is not the loudest
  -- thing on the roster, every assertion below passes for the wrong reason.
  select round(ff_score('{"pass_yd":500,"pass_td":6}'::jsonb, v_rules), 2) into v_bench_pts;
  select max(round(ff_score(s, v_rules), 2)) into v_top_pts
    from (values ('{"pass_yd":240,"pass_td":1}'::jsonb),
                 ('{"rush_yd":60,"rush_td":1}'::jsonb),
                 ('{"rec":5,"rec_yd":70}'::jsonb)) x(s);
  if v_bench_pts <= v_top_pts then
    raise exception 'the benched QB scored % against a best starter of % — the fixture is not testing anything',
      v_bench_pts, v_top_pts;
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------ the bench is there --
  if jsonb_array_length(v_h->'starters') <> 3 then
    raise exception 'the home side has % starters, expected 3', jsonb_array_length(v_h->'starters');
  end if;
  if jsonb_array_length(v_h->'bench') <> 2 then
    raise exception 'the home side has % on the bench, expected 2', jsonb_array_length(v_h->'bench');
  end if;
  if jsonb_array_length(v_a->'bench') <> 1 then
    raise exception 'the away side has % on the bench, expected 1', jsonb_array_length(v_a->'bench');
  end if;
  v_checks := v_checks + 3;

  -- Nobody appears twice, and nobody is on the wrong list.
  if exists (select 1 from jsonb_array_elements(v_h->'starters') as t(row)
              where t.row->>'slot' = 'BN') then
    raise exception 'a bench row is being served as a starter';
  end if;
  if exists (select 1 from jsonb_array_elements(v_h->'bench') as t(row)
              where t.row->>'slot' <> 'BN') then
    raise exception 'a starter is being served on the bench';
  end if;
  if exists (select 1
               from jsonb_array_elements(v_h->'bench')    as b(row)
               join jsonb_array_elements(v_h->'starters') as s(row)
                 on s.row->>'player_id' = b.row->>'player_id') then
    raise exception 'the same player is on both lists';
  end if;
  v_checks := v_checks + 3;

  -- The bench carries the whole row, not a summary of it: the box score and
  -- the game clock are exactly what the lineup rows draw from.
  if (v_h->'bench'->0->'stats') is null or (v_h->'bench'->0->'stats') = 'null'::jsonb then
    raise exception 'a bench row arrived with no stat line';
  end if;
  if v_h->'bench'->0->>'game_detail' <> 'Q2 8:41' then
    raise exception 'a bench row arrived with game_detail %', v_h->'bench'->0->>'game_detail';
  end if;
  if (v_h->'bench'->0->>'final')::boolean then
    raise exception 'a bench row whose game is on came back final';
  end if;
  -- Every bench slot is the same word, so position orders them: QB, then RB.
  if v_h->'bench'->0->>'position' <> 'QB' or v_h->'bench'->1->>'position' <> 'RB' then
    raise exception 'the bench is ordered %, % — expected QB then RB',
      v_h->'bench'->0->>'position', v_h->'bench'->1->>'position';
  end if;
  v_checks := v_checks + 4;

  -- ----------------------------------------------------- the bench is inert --
  -- Both of these count starters, and every starter's game is over.
  if (v_h->>'yet_to_play')::int <> 0 then
    raise exception 'yet_to_play is % — a bench player is being counted as still to come', v_h->>'yet_to_play';
  end if;
  if (v_h->>'in_action')::int <> 0 then
    raise exception 'in_action is % — a bench player is being counted as on the field', v_h->>'in_action';
  end if;
  v_checks := v_checks + 2;

  -- The projection is the starters' and only the starters'.
  select round(sum(round(ff_score(pj.stats, v_rules), 2)), 2) into v_expect
    from player_projections pj
   where pj.season = 2026 and pj.season_type = 2 and pj.week = v_week
     and pj.source = 'sleeper' and pj.player_id in (v_qb, v_rb, v_wr);
  if (v_h->>'proj')::numeric <> v_expect then
    raise exception 'proj is % against a starters-only total of %', v_h->>'proj', v_expect;
  end if;
  -- Nobody in the starting lineup has yet to kick, so nothing is left.
  if (v_h->>'proj_left')::numeric <> 0 then
    raise exception 'proj_left is % — a bench player''s projection is in it', v_h->>'proj_left';
  end if;
  v_checks := v_checks + 2;

  -- The man carrying the day is the best STARTER, not the best player.
  if v_h->'top'->>'full_name' <> 'Starting Quarterback' then
    raise exception 'top is % — the bench is being ranked with the lineup', v_h->'top'->>'full_name';
  end if;
  v_checks := v_checks + 1;

  -- Three slots, three starters, and two bench men who must not fill a hole
  -- or dig one.
  if (v_h->>'empty_slots')::int <> 0 then
    raise exception 'the home lineup reports % empty slots, expected 0', v_h->>'empty_slots';
  end if;
  if (v_a->>'empty_slots')::int <> 2 then
    raise exception 'the away lineup reports % empty slots, expected 2 — its bench row is filling one',
      v_a->>'empty_slots';
  end if;
  v_checks := v_checks + 2;

  raise notice 'scoreboard bench: % checks passed', v_checks;
end $$;

rollback;
