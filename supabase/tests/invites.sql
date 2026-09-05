-- ============================================================================
-- Invites: the link is the secret, and the address is not.
--
-- The two things this is really asserting are absences — that no query answers
-- "is this address in the league?", and that knowing a manager's address is not
-- enough to take his team. Both were true of the code this replaces, so both
-- are written down here rather than left to be noticed again.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_t1 uuid; v_t2 uuid;              -- two invited teams
  v_commish uuid; v_manager uuid; v_stranger uuid;
  v_token uuid; v_token2 uuid;
  v_row teams%rowtype;
  v_j jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (id, email) values
    (gen_random_uuid(), 'commish@example.com') returning id into v_commish;
  insert into auth.users (id, email) values
    (gen_random_uuid(), 'manager@example.com') returning id into v_manager;
  insert into auth.users (id, email) values
    (gen_random_uuid(), 'stranger@example.com') returning id into v_stranger;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Invite Test', 2026, v_commish, '["QB","RB","WR","TE","FLEX","K","DEF"]'::jsonb, '{}'::jsonb)
  returning id into v_league;

  insert into teams (league_id, name, owner_email) values
    (v_league, 'Team One', 'manager@example.com') returning id into v_t1;
  insert into teams (league_id, name, owner_email) values
    (v_league, 'Team Two', 'other@example.com') returning id into v_t2;

  -- ------------------------------------------- the oracle is gone entirely --
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ff_email_invited'
  ) then
    raise exception 'ff_email_invited still exists — it answered "is this address in the league" to anon';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------- minting a token --
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish)::text, true);
  v_token := ff_mint_invite(v_t1);
  if v_token is null then raise exception 'the commissioner got no token back'; end if;
  v_checks := v_checks + 1;

  if (select invite_sent_at from teams where id = v_t1) is null then
    raise exception 'minting an invite did not record when it was sent';
  end if;
  v_checks := v_checks + 1;

  -- Re-sending retires the old link rather than leaving two ways in.
  v_token2 := ff_mint_invite(v_t1);
  if v_token2 = v_token then raise exception 're-sending an invite reused the old token'; end if;
  v_checks := v_checks + 1;

  -- Nobody but the commissioner issues one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform ff_mint_invite(v_t2);
    raise exception 'a stranger minted an invite';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a stranger minted an invite' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the preview --
  -- The real token names the team; a wrong one says nothing at all, and says it
  -- the same way, so the response cannot be used to test guesses.
  v_j := ff_invite_preview(v_token2);
  if v_j->>'team' <> 'Team One' then raise exception 'a valid invite did not name its team'; end if;
  v_checks := v_checks + 1;

  if ff_invite_preview(gen_random_uuid()) is not null then
    raise exception 'an invented token previewed something';
  end if;
  v_checks := v_checks + 1;

  -- The retired token is as dead as an invented one.
  if ff_invite_preview(v_token) is not null then
    raise exception 'a superseded token still previews';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- claiming it --
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  v_row := ff_claim_invite(v_token2);
  if v_row.id <> v_t1 then raise exception 'claiming the invite bound the wrong team'; end if;
  v_checks := v_checks + 1;

  if (select owner_id from teams where id = v_t1) is distinct from v_manager then
    raise exception 'the team was not bound to the claiming account';
  end if;
  v_checks := v_checks + 1;

  -- Single use: the token is spent.
  if (select invite_token from teams where id = v_t1) is not null then
    raise exception 'the token survived being claimed';
  end if;
  v_checks := v_checks + 1;

  -- A second claim on a spent token fails rather than moving the team.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform ff_claim_invite(v_token2);
    raise exception 'a spent token was claimed twice';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a spent token was claimed twice' then raise; end if;
  end;
  if (select owner_id from teams where id = v_t1) is distinct from v_manager then
    raise exception 'a second claim moved a team that was already owned';
  end if;
  v_checks := v_checks + 1;

  -- Claiming again as the owner is a no-op, not an error: /join retries it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  v_row := ff_claim_invite(gen_random_uuid());
  if v_row.id <> v_t1 then raise exception 'an owner re-running the claim lost his team'; end if;
  v_checks := v_checks + 1;

  -- ------------------------------- knowing the address buys you nothing --
  -- Team Two still carries other@example.com and has no owner. This is the
  -- takeover ff_link_me used to allow: sign up as that address, get the team.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  update auth.users set email = 'other@example.com' where id = v_stranger;

  if ff_link_me() is not null then
    raise exception 'ff_link_me handed over a team on a matching address alone';
  end if;
  if (select owner_id from teams where id = v_t2) is not null then
    raise exception 'a team was claimed by address, with no invite token';
  end if;
  v_checks := v_checks + 2;

  -- And it still finds a team you already own.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  v_row := ff_link_me();
  if v_row.id <> v_t1 then raise exception 'ff_link_me lost a team its owner already holds'; end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('anon', 'public.ff_claim_invite(uuid)', 'execute') then
    raise exception 'anon can claim invites';
  end if;
  if has_function_privilege('anon', 'public.ff_mint_invite(uuid)', 'execute') then
    raise exception 'anon can mint invites';
  end if;
  if has_function_privilege('anon', 'public.ff_link_me()', 'execute') then
    raise exception 'anon can call ff_link_me';
  end if;
  -- This one anon must reach: nobody is signed in when they open their link.
  if not has_function_privilege('anon', 'public.ff_invite_preview(uuid)', 'execute') then
    raise exception 'anon cannot preview an invite, so /join cannot render';
  end if;
  v_checks := v_checks + 4;

  raise notice 'invites: % checks passed', v_checks;
end $$;

rollback;
