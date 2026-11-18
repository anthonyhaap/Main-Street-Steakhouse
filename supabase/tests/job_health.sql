-- ============================================================================
-- ff_job_health: only the commissioner may ask, and "on time" is judged by
-- each job's own schedule — a weekly job is not late on day five, a run in
-- progress is not a failure, and a job switched off is off, not late.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_commish uuid; v_manager uuid;
  v_j jsonb;
  v_err text;
  v_checks integer := 0;
  v_id bigint;
begin
  insert into auth.users (email) values ('jh-commish@example.test') returning id into v_commish;
  insert into auth.users (email) values ('jh-manager@example.test') returning id into v_manager;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Job Health Test', 2026, v_commish, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada', v_commish);
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_manager);

  -- ------------------------------------------------------------ who may ask --
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  begin
    perform ff_job_health(v_league);
    raise exception 'a manager who is not the commissioner was shown job health';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%only the commissioner%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims', '', true);
  begin
    perform ff_job_health(v_league);
    raise exception 'a caller with no session was shown job health';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%only the commissioner%' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ----------------------------------------------------- a history to judge --
  -- `now()` is frozen for the transaction, so every run is placed relative to it.
  v_id := cron.schedule('jh-minutely', '* * * * *', 'select 1');
  insert into cron.job_run_details (jobid, status, start_time) values (v_id, 'succeeded', now() - interval '2 minutes');

  v_id := cron.schedule('jh-weekly', '0 13 * * 4', 'select 1');
  insert into cron.job_run_details (jobid, status, start_time) values (v_id, 'succeeded', now() - interval '5 days');

  v_id := cron.schedule('jh-daily-stale', '0 9 * * *', 'select 1');
  insert into cron.job_run_details (jobid, status, start_time) values (v_id, 'succeeded', now() - interval '3 days');

  v_id := cron.schedule('jh-just-failed', '*/5 * * * *', 'select 1');
  insert into cron.job_run_details (jobid, status, start_time) values
    (v_id, 'succeeded', now() - interval '6 minutes'),
    (v_id, 'failed',    now() - interval '1 minute');

  v_id := cron.schedule('jh-running', '5 seconds', 'select 1');
  insert into cron.job_run_details (jobid, status, start_time) values
    (v_id, 'succeeded', now() - interval '10 seconds'),
    (v_id, 'running',   now());

  v_id := cron.schedule('jh-never', '*/15 * * * *', 'select 1');

  v_id := cron.schedule('jh-off', '0 9 * * *', 'select 1');
  update cron.job set active = false where jobid = v_id;

  -- ------------------------------------------------------ the commissioner --
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish)::text, true);
  v_j := ff_job_health(v_league);

  if not (v_j->>'available')::boolean then raise exception 'job health reported unavailable: %', v_j; end if;
  v_checks := v_checks + 1;

  declare
    v_expect jsonb := jsonb_build_object(
      'jh-minutely',    true,   -- ran two minutes ago, inside ten
      'jh-weekly',      true,   -- five days ago is on time for a weekly job
      'jh-daily-stale', false,  -- three days ago is late for a daily one
      'jh-just-failed', false,  -- its last finished run failed
      'jh-running',     true,   -- a run in progress is judged by the one before
      'jh-never',       false,  -- no run at all
      'jh-off',         null    -- switched off: not late, not on time
    );
    v_name text;
    v_got jsonb;
  begin
    for v_name in select jsonb_object_keys(v_expect) loop
      select j->'healthy' into v_got from jsonb_array_elements(v_j->'jobs') j where j->>'name' = v_name;
      if v_got is null then raise exception 'job % missing from %', v_name, v_j->'jobs'; end if;
      if v_got <> v_expect->v_name then
        raise exception 'job %: healthy was %, expected %', v_name, v_got, v_expect->v_name;
      end if;
      v_checks := v_checks + 1;
    end loop;
  end;

  raise notice 'job_health: % checks passed', v_checks;
end $$;

rollback;
