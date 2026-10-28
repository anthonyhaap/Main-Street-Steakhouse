-- ============================================================================
-- Sunday Live and the Thursday prediction poll: system-authored, pinned or
-- posted once per league per week no matter how many times the cron job
-- runs, closed only by its own follow-up job.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other uuid;
  v_uid_a uuid; v_uid_b uuid;
  v_j jsonb;
  v_msg uuid;
  v_week integer;
  v_n integer;
  v_checks integer := 0;
begin
  insert into auth.users (email) values ('sla@example.test') returning id into v_uid_a;
  insert into auth.users (email) values ('slb@example.test') returning id into v_uid_b;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Scheduled Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Scheduled Elsewhere', 2026, v_uid_b, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada', v_uid_a);
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_uid_b);
  insert into teams (league_id, name, manager_name, owner_id) values (v_other, 'Charlie', 'Cy', v_uid_b);

  -- ------------------------------------------------------------ Sunday Live --
  v_j := ff_open_sunday_live();
  if (select count(*) from league_messages where league_id = v_league and body like '🏈 Sunday Live%') <> 1 then
    raise exception 'Sunday Live did not post exactly once';
  end if;
  if not (select pinned from league_messages where league_id = v_league and body like '🏈 Sunday Live%') then
    raise exception 'Sunday Live was not pinned when opened';
  end if;
  if (select kind from league_messages where league_id = v_league and body like '🏈 Sunday Live%') <> 'house' then
    raise exception 'Sunday Live was not posted as the house';
  end if;
  v_checks := v_checks + 3;

  -- It reached the other league too — every league gets its own thread.
  if (select count(*) from league_messages where league_id = v_other and body like '🏈 Sunday Live%') <> 1 then
    raise exception 'Sunday Live skipped a second league';
  end if;
  v_checks := v_checks + 1;

  -- Running it again the same week does not double-post.
  perform ff_open_sunday_live();
  if (select count(*) from league_messages where league_id = v_league and body like '🏈 Sunday Live%') <> 1 then
    raise exception 'running the job twice in one week posted twice';
  end if;
  v_checks := v_checks + 1;

  -- And in the League Feed it shows up pinned.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_league_feed(v_league, null, 40);
  if jsonb_array_length(v_j->'pinned') <> 1 then raise exception 'Sunday Live did not reach the pinned rail'; end if;
  v_checks := v_checks + 1;

  -- Closing it takes it off the rail without deleting the line.
  v_msg := (select id from league_messages where league_id = v_league and body like '🏈 Sunday Live%');
  perform ff_close_sunday_live();
  if (select pinned from league_messages where id = v_msg) then
    raise exception 'Sunday Live was still pinned after closing';
  end if;
  if not exists (select 1 from league_messages where id = v_msg) then
    raise exception 'closing Sunday Live deleted the post';
  end if;
  v_checks := v_checks + 2;

  -- Closing again is a no-op, not an error.
  perform ff_close_sunday_live();
  v_checks := v_checks + 1;

  -- --------------------------------------------------- Thursday prediction --
  v_week := ff_current_week();
  v_j := ff_post_weekly_prediction();
  if not exists (select 1 from weekly_predictions where league_id = v_league and week = v_week) then
    raise exception 'the weekly prediction was not recorded';
  end if;

  select p.id into v_msg from polls p
    join weekly_predictions wp on wp.poll_id = p.id
   where wp.league_id = v_league and wp.week = v_week;
  if v_msg is null then raise exception 'the weekly prediction poll was not created'; end if;

  select count(*) into v_n from poll_options where poll_id = v_msg;
  if v_n <> 2 then raise exception 'the prediction poll had % options, expected one per team (2)', v_n; end if;
  v_checks := v_checks + 3;

  -- Running it again this week does not ask twice.
  perform ff_post_weekly_prediction();
  if (select count(*) from weekly_predictions where league_id = v_league and week = v_week) <> 1 then
    raise exception 'running the job twice in one week posted a second poll';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('authenticated', 'public.ff_open_sunday_live()', 'execute') then
    raise exception 'a manager can open Sunday Live directly';
  end if;
  if has_function_privilege('authenticated', 'public.ff_post_weekly_prediction()', 'execute') then
    raise exception 'a manager can post the weekly prediction directly';
  end if;
  v_checks := v_checks + 2;

  raise notice 'scheduled league feed posts: % checks passed', v_checks;
end $$;

rollback;
