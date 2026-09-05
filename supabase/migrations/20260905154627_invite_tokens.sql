-- ============================================================================
-- An invite is a secret link, not a guessable email address.
--
-- ff_email_invited answered "is this address in the league?" for any address,
-- to anyone holding the publishable key — which ships in the browser bundle. It
-- was SECURITY DEFINER, so it read `teams` straight through RLS, and /join
-- called it before anybody had signed in, so it had to be anon-callable. An
-- unauthenticated membership oracle for a twelve-person league is a small thing
-- in absolute terms and an unnecessary one in every term.
--
-- Underneath it was the larger bug. ff_link_me claimed a team by matching the
-- caller's address against owner_email wherever owner_id was still null, and
-- this project deliberately runs with email confirmation OFF (the /join screen
-- says so). Nothing proved the person signing up owned the address. So for any
-- invited-but-unclaimed team, whoever signed up with that manager's address
-- first got his team — and the oracle was a way to find out which addresses
-- were worth trying. Today no team is in that state (0 with an email and no
-- owner), which is exactly why this is the moment to change the mechanism:
-- there is no outstanding invite to strand.
--
-- So the address stops being the credential and a token takes over:
--
--   commissioner sets the email  ->  ff_mint_invite issues a token
--   the invite mail goes to that address, carrying /join?t=<token>
--   whoever holds the token claims the team, once
--
-- The token is a v4 uuid, single-use, cleared on claim. It is delivered only to
-- the address the commissioner recorded, so possession of it still means the
-- manager read his own mail — but nothing about the flow depends on guessing,
-- and no query answers questions about who is in the league.
--
-- ff_invite_preview is anon-callable on purpose: nobody is signed in when they
-- open their link, and the screen should be able to say which team it is for.
-- It is safe because it takes the secret, not the address. A wrong token is
-- indistinguishable from an expired one.
-- ============================================================================

alter table public.teams add column if not exists invite_token   uuid;
alter table public.teams add column if not exists invite_sent_at timestamptz;

-- Partial rather than plain: a claimed team's token is set back to null, and
-- several nulls must be allowed to coexist.
create unique index if not exists teams_invite_token_key
  on public.teams (invite_token) where invite_token is not null;

comment on column public.teams.invite_token is
  'Single-use secret in this team''s invite link. Cleared the moment the team is claimed; null means there is no live invite.';

-- ------------------------------------------------------------ issuing one --

create or replace function public.ff_mint_invite(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid; v_token uuid;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  perform ff_assert_commissioner(v_league);

  if (select owner_id from teams where id = p_team_id) is not null then
    raise exception 'that team has already been claimed';
  end if;
  if (select owner_email from teams where id = p_team_id) is null then
    raise exception 'give the team an email first — the link is sent to it';
  end if;

  -- A fresh token every time it is sent, so re-sending an invite silently
  -- retires the previous link rather than leaving two live ways in.
  v_token := gen_random_uuid();
  update teams set invite_token = v_token, invite_sent_at = now()
   where id = p_team_id;

  return v_token;
end $$;

-- ------------------------------------------------------------ opening one --

-- What the /join screen may say before anybody has signed in. Takes the secret
-- and returns the two names on it; a token that is wrong, spent, or belongs to
-- a team since claimed returns null, all identically.
create or replace function public.ff_invite_preview(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('team', t.name, 'league', l.name, 'manager', t.manager_name)
    from teams t join leagues l on l.id = t.league_id
   where t.invite_token = p_token and t.owner_id is null
$$;

-- ------------------------------------------------------------ claiming one --

create or replace function public.ff_claim_invite(p_token uuid)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare v teams%rowtype;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  -- Already holding a team is not an error: /join runs this straight after
  -- sign-up, and a retried submit must not look like a failure.
  select * into v from teams where owner_id = auth.uid() limit 1;
  if found then return v; end if;

  -- The token and the unclaimed state are checked in the same statement, so two
  -- people opening the same link race for one update rather than both winning.
  update teams set owner_id = auth.uid(), invite_token = null
   where invite_token = p_token and owner_id is null
  returning * into v;

  if not found then
    raise exception 'that invite link is not valid any more — ask your commissioner to send a new one';
  end if;
  return v;
end $$;

-- --------------------------------------------------------------- linking --

-- Was: claim whatever team carries my address and has no owner yet. That is the
-- takeover described at the top, and with the token flow there is nothing left
-- for it to do — a team is bound by ff_claim_invite and by nothing else. It
-- stays as a lookup because session.tsx calls it on every session load.
create or replace function public.ff_link_me()
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare v teams%rowtype;
begin
  if auth.uid() is null then return null; end if;
  select * into v from teams where owner_id = auth.uid() limit 1;
  if found then return v; end if;
  return null;
end $$;

-- -------------------------------------------------------------- the oracle --

drop function if exists public.ff_email_invited(text);

-- -------------------------------------------------------------- the grants --
-- Revoking `from public, anon` is NOT enough on this project: it carries
-- `alter default privileges ... grant execute on functions to ... authenticated`,
-- so a new function is granted to authenticated the instant it exists. Anything
-- that should not be manager-callable has to be named here explicitly. See
-- 20260905144124 and supabase/tests/grants.sql.
revoke execute on function public.ff_mint_invite(uuid)     from public, anon;
revoke execute on function public.ff_invite_preview(uuid)  from public;
revoke execute on function public.ff_claim_invite(uuid)    from public, anon;
revoke execute on function public.ff_link_me()             from public, anon;

-- Commissioner-checked inside; the API route calls it as the signed-in user.
grant execute on function public.ff_mint_invite(uuid)      to authenticated, service_role;
-- The one thing here anon may call, and only with the secret in hand.
grant execute on function public.ff_invite_preview(uuid)   to anon, authenticated, service_role;
grant execute on function public.ff_claim_invite(uuid)     to authenticated, service_role;
grant execute on function public.ff_link_me()              to authenticated, service_role;
