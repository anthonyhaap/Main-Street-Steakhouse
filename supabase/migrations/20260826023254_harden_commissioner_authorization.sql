-- SECURITY FIX.
--
-- ff_assert_commissioner treated "this league has no commissioner yet" as
-- "everyone is the commissioner". leagues.commissioner_id was NULL, so ANY
-- signed-in manager could start, pause, or undo picks in the draft.
--
-- The auth.uid() IS NULL escape stays deliberately: that is the service role
-- and the SQL editor, which must be able to repair state. The `anon` role has
-- no EXECUTE on any ff_* mutation, so no unauthenticated caller reaches here.

create or replace function public.ff_assert_commissioner(p_league_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then return; end if;
  if not exists (select 1 from leagues where id = p_league_id and commissioner_id = auth.uid()) then
    if exists (select 1 from leagues where id = p_league_id and commissioner_id is null) then
      raise exception 'this league has no commissioner yet - claim it first';
    end if;
    raise exception 'not authorized: commissioner only';
  end if;
end;
$fn$;
