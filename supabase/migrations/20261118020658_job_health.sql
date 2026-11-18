-- ============================================================================
-- ff_job_health — are the league's scheduled jobs running on time?
--
-- The commissioner's job-health panel used to come out of ff_league_pulse,
-- which found each job's latest run with
--
--   select ... from cron.job_run_details where jobid = $1
--    order by start_time desc limit 1
--
-- once per job. job_run_details has no index but its primary key (runid), and
-- by 2026-11-18 it held 1.2 million rows (303 MB): draft-tick alone logs a run
-- every five seconds. Nineteen jobs meant nineteen passes over all of it, and
-- the call ran past a minute — which is why /league never loaded and was
-- retired.
--
-- This reads only the newest 200,000 runs (about ten days at the current rate,
-- enough to see a weekly job) through a range on runid, which IS indexed, and
-- groups them once. About a tenth of a second on the live table.
--
-- "Healthy" is judged per schedule, so a weekly job is not late on day two:
--
--   every N seconds   2 minutes
--   every minute      10 minutes
--   every N minutes   4 × N minutes, at least 10
--   a day of the week 8 days
--   a day of a month  32 days
--   anything else     36 hours (daily, or a few times a day)
--
-- and a job is healthy when its last FINISHED run succeeded and it has
-- succeeded inside that window. A run in progress is neither, so a job that
-- fires every five seconds does not flicker red while it is running. A job
-- switched off is reported as off, not as late.
--
-- Commissioner only: it lists every job by name and schedule, which is the
-- league's plumbing, not a manager's business.
-- ============================================================================

create or replace function public.ff_job_health(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_commish uuid;
  v_jobs    jsonb;
begin
  select commissioner_id into v_commish from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;
  if v_uid is null or v_commish is distinct from v_uid then
    raise exception 'only the commissioner can see job health';
  end if;

  begin
    with recent as (
      select d.jobid, d.runid, d.status, d.start_time
        from cron.job_run_details d
       where d.runid > (select coalesce(max(runid), 0) from cron.job_run_details) - 200000
    ),
    per_job as (
      select jobid,
             max(runid) filter (where status in ('succeeded', 'failed')) as done_runid,
             max(start_time) filter (where status = 'succeeded')         as last_success
        from recent
       group by jobid
    ),
    judged as (
      select c.jobname, c.schedule, c.active,
             d.start_time as last_run, d.status as last_status, p.last_success,
             case
               when c.schedule ~* '^\s*\d+\s*seconds?\s*$'           then interval '2 minutes'
               when c.schedule ~ '^\s*\*\s+\*\s+\*\s+\*\s+\*\s*$'     then interval '10 minutes'
               when c.schedule ~ '^\s*\*/\d+\s'                      then greatest(interval '10 minutes',
                      make_interval(mins => 4 * substring(c.schedule from '^\s*\*/(\d+)')::int))
               when split_part(regexp_replace(trim(c.schedule), '\s+', ' ', 'g'), ' ', 5) not in ('', '*')
                                                                     then interval '8 days'
               when split_part(regexp_replace(trim(c.schedule), '\s+', ' ', 'g'), ' ', 3) not in ('', '*')
                                                                     then interval '32 days'
               else interval '36 hours'
             end as grace
        from cron.job c
        left join per_job p on p.jobid = c.jobid
        left join cron.job_run_details d on d.runid = p.done_runid
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'name',         jobname,
             'schedule',     schedule,
             'active',       active,
             'last_run',     last_run,
             'last_status',  last_status,
             'last_success', last_success,
             'healthy',      case when not active then null
                                  else coalesce(last_status = 'succeeded'
                                                and last_success > now() - grace, false) end
           ) order by jobname), '[]'::jsonb)
      into v_jobs
      from judged;
  exception when others then
    return jsonb_build_object('available', false, 'jobs', '[]'::jsonb, 'checked_at', now());
  end;

  return jsonb_build_object(
    'available',  true,
    'jobs',       v_jobs,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.ff_job_health(uuid) from public, anon;
grant execute on function public.ff_job_health(uuid) to authenticated;

comment on function public.ff_job_health(uuid) is
  'Commissioner only. Each pg_cron job with its last finished run, last success, and whether it is on time for its schedule.';
