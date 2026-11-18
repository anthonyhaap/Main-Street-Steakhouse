\echo Use "CREATE EXTENSION pg_cron" to load this file. \quit

-- The two tables `ff_league_pulse` reads for automation health, with the
-- columns it names: jobname, schedule, active, and status/start_time.
create table job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  nodename text not null default 'localhost',
  nodeport integer not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active   boolean not null default true,
  jobname  text unique
);

create table job_run_details (
  jobid          bigint,
  runid          bigserial primary key,
  job_pid        integer,
  database       text,
  username       text,
  command        text,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);

-- Upsert on jobname, which is what real pg_cron does for the 3-argument form:
-- re-scheduling an existing name replaces it rather than adding a second job.
create function schedule(job_name text, schedule text, command text)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update
    set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid into v_id;
  return v_id;
end $$;

create function schedule(schedule text, command text)
returns bigint
language sql
as $$
  insert into cron.job (schedule, command) values (schedule, command) returning jobid
$$;

create function unschedule(job_id bigint) returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobid = job_id;
  return found;
end $$;

create function unschedule(job_name text) returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = job_name;
  return found;
end $$;

-- Real pg_cron's signature: every argument after the job is optional, and a
-- null leaves that column as it was.
create function alter_job(
  job_id   bigint,
  schedule text    default null,
  command  text    default null,
  database text    default null,
  username text    default null,
  active   boolean default null
) returns void
language plpgsql
as $$
begin
  update cron.job j
     set schedule = coalesce(alter_job.schedule, j.schedule),
         command  = coalesce(alter_job.command,  j.command),
         database = coalesce(alter_job.database, j.database),
         username = coalesce(alter_job.username, j.username),
         active   = coalesce(alter_job.active,   j.active)
   where j.jobid = job_id;
  if not found then raise exception 'could not find valid entry for job %', job_id; end if;
end $$;
