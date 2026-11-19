\echo Use "CREATE EXTENSION pg_net" to load this file. \quit

-- pg_net keeps its functions in `net` whatever schema the extension is
-- created in. The real http_get queues a request and returns its id; this
-- queues nothing and returns 0, so a replay proves the callers compile.
create schema if not exists net;

create function net.http_get(
  url                  text,
  params               jsonb   default '{}'::jsonb,
  headers              jsonb   default '{}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
language sql volatile
as $$ select 0::bigint $$;
