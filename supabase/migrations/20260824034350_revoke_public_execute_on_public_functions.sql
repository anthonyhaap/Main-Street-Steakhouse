-- The previous revoke removed anon's explicit grant, but Postgres grants
-- EXECUTE to PUBLIC by default on every function (the "=X/postgres" ACL entry),
-- and anon inherited it that way. Remove the PUBLIC grant; authenticated and
-- service_role hold their own explicit grants and are unaffected.
revoke execute on all functions in schema public from public;
alter default privileges in schema public revoke execute on functions from public;
grant execute on all functions in schema public to authenticated, service_role;