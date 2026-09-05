\echo Use "CREATE EXTENSION http" to load this file. \quit

-- The composite pgsql-http returns. `20260809015520_nflverse_player_loader`
-- and eleven other call sites read `.content` off it.
create type http_header as (field varchar, value varchar);

create type http_response as (
  status       integer,
  content_type varchar,
  headers      http_header[],
  content      varchar
);

-- Returns a null body. Every loader that calls this raises on a short body, so
-- a replay proves the loader COMPILES and is reachable; it deliberately does
-- not pretend the fetch succeeded.
create function http_get(uri varchar) returns http_response
language sql immutable
as $$ select (0, null, null, null)::http_response $$;

create function http_get(uri varchar, data jsonb) returns http_response
language sql immutable
as $$ select (0, null, null, null)::http_response $$;
