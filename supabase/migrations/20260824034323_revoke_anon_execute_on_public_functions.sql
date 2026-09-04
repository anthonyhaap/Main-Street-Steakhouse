-- Authorization inside these SECURITY DEFINER functions is written as
--   if auth.uid() is not null then <check> end if;
-- so an unauthenticated caller skips every check. The anon key is public
-- (it ships in the browser bundle), which made every draft/lineup/league
-- mutation callable by anyone. Remove anon's ability to call them at all.
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke execute on functions from anon;