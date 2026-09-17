-- ============================================================================
-- The Weekly Special, with your line in it.
--
-- Four teams, three weeks, and the publisher run the way the cron runs it.
-- The checks are the sentences — the result, the place in the table, the
-- streak — and the restraint: a seat with no device hears nothing, a manager
-- who switched recaps off hears nothing, a co-owner hears the seat's line, and
-- publishing twice sends nothing twice.
--
-- The bench clause reads roster_points, a view over rosters and scored stats
-- that this fixture does not seed; it is the Special's own test, verified
-- against production in 20260904022842, and stays silent here.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p is null then '' else json_build_object('sub', p)::text end, true);
end $$;

do $$
declare
  v_league uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_c uuid; v_uid_d uuid; v_uid_co uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_line jsonb; v_out jsonb; v_row record; v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values (gen_random_uuid(), 'a@example.com')  returning id into v_uid_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'b@example.com')  returning id into v_uid_b;
  insert into auth.users (id, email) values (gen_random_uuid(), 'c@example.com')  returning id into v_uid_c;
  insert into auth.users (id, email) values (gen_random_uuid(), 'd@example.com')  returning id into v_uid_d;
  insert into auth.users (id, email) values (gen_random_uuid(), 'co@example.com') returning id into v_uid_co;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Recap Test', 2026, v_uid_a, '["QB","RB","WR","TE","FLEX","K","DEF"]'::jsonb, '{}'::jsonb)
  returning id into v_league;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha',   'Ada Lovelace', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo',   'Bo Jackson',   v_uid_b) returning id into v_b;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Charlie', 'Cy Young',     v_uid_c) returning id into v_c;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Delta',   'Di Prince',    v_uid_d) returning id into v_d;
  insert into team_co_owners (team_id, user_id, league_id) values (v_b, v_uid_co, v_league);

  -- Three weeks, all final. A beats B every week; C and D split the first two
  -- with D ahead on points, and C takes the third by a whisker.
  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('recap-w1', 2026, 2, 1, 'SEA', 'NE', now() - interval '20 days', 'post'),
         ('recap-w2', 2026, 2, 2, 'NE', 'SEA', now() - interval '13 days', 'post'),
         ('recap-w3', 2026, 2, 3, 'SEA', 'NE', now() - interval '6 days',  'post');
  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points) values
    (v_league, 1, v_a, v_b, 110.0, 90.0), (v_league, 1, v_c, v_d, 100.0, 105.0),
    (v_league, 2, v_b, v_a, 95.0, 120.0), (v_league, 2, v_d, v_c, 98.0, 101.0),
    (v_league, 3, v_a, v_b, 112.4, 100.0), (v_league, 3, v_c, v_d, 99.9, 99.1);

  -- Who can be reached: A, and B's co-owner. B, C and D have no device.
  perform pg_temp.as_user(v_uid_a);  perform ff_save_push_subscription('https://push.example/a',  'k', 'a', 'Safari');
  perform pg_temp.as_user(v_uid_co); perform ff_save_push_subscription('https://push.example/co', 'k', 'a', 'Chrome');
  -- A has switched recaps off.
  perform pg_temp.as_user(v_uid_a);  perform ff_set_notification_prefs(true, true, true, false);
  perform pg_temp.as_user(null);

  -- --------------------------------------------------------- the sentences --
  v_line := ff_personal_recap_line(v_league, 3, v_a);
  if v_line->>'title' <> 'You beat Bo by 12.4.' then raise exception 'A''s title reads "%"', v_line->>'title'; end if;
  -- Three wins running, and first both weeks: no movement to report.
  if v_line->>'body' <> 'Three straight.' then raise exception 'A''s body reads "%"', v_line->>'body'; end if;
  v_checks := v_checks + 2;

  v_line := ff_personal_recap_line(v_league, 3, v_b);
  if v_line->>'title' <> 'Lost by 12.4 to Ada.' then raise exception 'B''s title reads "%"', v_line->>'title'; end if;
  if v_line->>'body' <> 'Three losses in a row.' then raise exception 'B''s body reads "%"', v_line->>'body'; end if;
  v_checks := v_checks + 2;

  -- C: 1-1 and third on points after week 2, second on wins after week 3. The
  -- two-game streak goes unsaid because the table already filled the line.
  v_line := ff_personal_recap_line(v_league, 3, v_c);
  if v_line->>'title' <> 'You beat Di by 0.8.' then raise exception 'C''s title reads "%"', v_line->>'title'; end if;
  if v_line->>'body' <> 'Up to 2nd.' then raise exception 'C''s body reads "%"', v_line->>'body'; end if;
  v_checks := v_checks + 2;

  v_line := ff_personal_recap_line(v_league, 3, v_d);
  if v_line->>'title' <> 'Lost by 0.8 to Cy.' then raise exception 'D''s title reads "%"', v_line->>'title'; end if;
  if v_line->>'body' <> 'Down to 3rd.' then raise exception 'D''s body reads "%"', v_line->>'body'; end if;
  v_checks := v_checks + 2;

  -- Week 1 has no "before", so it never claims movement; a week nobody played
  -- has no line at all.
  v_line := ff_personal_recap_line(v_league, 1, v_d);
  if v_line->>'body' <> 'The Weekly Special is up. Tap to read the week.' then raise exception 'week 1 body reads "%"', v_line->>'body'; end if;
  if ff_personal_recap_line(v_league, 9, v_a) is not null then raise exception 'an unplayed week got a line'; end if;
  v_checks := v_checks + 2;

  -- ----------------------------------------------------------- the publish --
  delete from notification_outbox;
  v_out := ff_publish_recap(v_league, 3);
  if not (v_out->>'posted')::boolean then raise exception 'the Special was not posted: %', v_out; end if;
  if (v_out->>'notified')::int <> 1 then raise exception 'publishing owed % line(s), expected 1 (B''s co-owner)', v_out->>'notified'; end if;
  v_checks := v_checks + 2;

  select * into v_row from notification_outbox;
  if v_row.user_id <> v_uid_co then raise exception 'the one line went to the wrong person'; end if;
  if v_row.kind <> 'recap' then raise exception 'the line was filed as %', v_row.kind; end if;
  if v_row.url <> '/recap/3' then raise exception 'the line points at %', v_row.url; end if;
  if v_row.title <> 'Lost by 12.4 to Ada.' then raise exception 'the co-owner''s line reads "%"', v_row.title; end if;
  if exists (select 1 from notification_outbox where user_id = v_uid_a) then
    raise exception 'a manager who switched recaps off was sent one';
  end if;
  v_checks := v_checks + 5;

  -- Twice is once.
  v_out := ff_publish_recap(v_league, 3);
  if (v_out->>'posted')::boolean then raise exception 'the Special was posted twice'; end if;
  if (select count(*) from notification_outbox) <> 1 then raise exception 'a second publish sent the lines again'; end if;
  if (select count(*) from league_messages where league_id = v_league and kind = 'house') <> 1 then
    raise exception 'two house posts for one week';
  end if;
  v_checks := v_checks + 3;

  -- The drain sees it like any other.
  v_out := ff_push_batch(10);
  if jsonb_array_length(v_out) <> 1 or v_out->0->>'kind' <> 'recap' then raise exception 'the drain did not take the line'; end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('authenticated', 'public.ff_recap_notify(uuid,integer)', 'execute') then
    raise exception 'a manager can send the league its lines';
  end if;
  if not has_function_privilege('authenticated', 'public.ff_personal_recap_line(uuid,integer,uuid)', 'execute') then
    raise exception 'a manager cannot read his own line';
  end if;
  -- And only a member reads it.
  perform pg_temp.as_user(gen_random_uuid());
  begin
    perform ff_personal_recap_line(v_league, 3, v_a);
    raise exception 'a stranger read a line';
  exception when others then
    if sqlerrm not like '%not a member%' then raise; end if;
  end;
  perform pg_temp.as_user(null);
  v_checks := v_checks + 3;

  raise notice 'recap push: % checks passed', v_checks;
end $$;

rollback;
