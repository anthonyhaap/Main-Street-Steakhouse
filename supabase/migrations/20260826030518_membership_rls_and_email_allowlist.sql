-- No-email onboarding + tighter reads.
--
-- The league abandoned email-based auth entirely: SMTP was unreliable and a
-- 12-person private league does not need a mail server to vouch for people the
-- commissioner already knows. Managers now set a password at /join, gated by
-- the commissioner's list of team emails.
--
-- Because signup is therefore open, "signed in" can no longer imply "in this
-- league" — hence ff_is_member() below.

create or replace function public.ff_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams   where owner_id        = auth.uid())
      or exists (select 1 from leagues where commissioner_id = auth.uid())
$$;
grant execute on function public.ff_is_member() to authenticated;

-- Is this email on a team? Called by /join before signup. Exact match only; it
-- confirms nothing an invited manager does not already know.
create or replace function public.ff_email_invited(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where lower(owner_email) = lower(trim(p_email)))
$$;
grant execute on function public.ff_email_invited(text) to anon, authenticated;

-- League-scoped tables require membership, not merely a session.
do $$
declare t text;
begin
  foreach t in array array[
    'leagues','teams','drafts','draft_picks','rosters','matchups','league_scoring_rules'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.ff_is_member())',
      t || '_read', t);
  end loop;
end $$;

-- A draft queue is a manager's private board. Previously EVERY authenticated
-- user could read EVERY team's queue, which during a live draft is exactly the
-- information someone would pay for.
drop policy if exists draft_queue_read on public.draft_queue;
create policy draft_queue_read on public.draft_queue
  for select to authenticated
  using (
    exists (
      select 1 from teams t
      where t.id = draft_queue.team_id
        and (
          t.owner_id = auth.uid()
          or exists (select 1 from leagues l
                     where l.id = t.league_id and l.commissioner_id = auth.uid())
        )
    )
  );
