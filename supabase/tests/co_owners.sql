-- ============================================================================
-- Co-owners: a second person at the seat, with the seat's standing.
--
-- Three things are being asserted. That a co-owner is a manager everywhere the
-- database asks — membership, ownership, the queue, the crest, the house. That
-- the seat is handed out only by the people who hold it, and held by one
-- person per league. And, the one that matters most a month from now, that no
-- function has gone back to deciding ownership by owner_id alone — because the
-- migration rewrote twenty of them in place, and a later migration that pastes
-- an older body over one of them would lock co-owners out of a screen without
-- a single error anywhere.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other_league uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid;
  v_commish uuid; v_owner uuid; v_friend uuid; v_rival uuid; v_stranger uuid;
  v_token uuid; v_token2 uuid; v_invite_id uuid;
  v_row teams%rowtype;
  v_j jsonb; v_err text; v_left text;
  v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('commish@example.test')  returning id into v_commish;
  insert into auth.users (email) values ('owner@example.test')    returning id into v_owner;
  insert into auth.users (email) values ('friend@example.test')   returning id into v_friend;
  insert into auth.users (email) values ('rival@example.test')    returning id into v_rival;
  insert into auth.users (email) values ('stranger@example.test') returning id into v_stranger;
  insert into profiles (id, display_name) values (v_friend, 'Frankie');

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Co-owner Test', 2026, v_commish, '["QB","RB","WR","TE","FLEX","K","DEF"]'::jsonb, '{}'::jsonb)
  returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Elsewhere', 2026, v_commish, '["QB"]'::jsonb, '{}'::jsonb)
  returning id into v_other_league;

  insert into teams (league_id, name, manager_name, owner_id, owner_email)
  values (v_league, 'The Regulars', 'Owen', v_owner, 'owner@example.test') returning id into v_t1;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'The Rivals', 'Riva', v_rival) returning id into v_t2;
  insert into teams (league_id, name)
  values (v_league, 'Nobody Yet') returning id into v_t3;

  -- ------------------------------------------------- who may hand out a seat --
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_j := ff_invite_co_owner(v_t1, 'Friend@Example.test');
  v_token := (v_j->>'token')::uuid;
  if v_token is null then raise exception 'the owner got no token back'; end if;
  if v_j->>'email' <> 'friend@example.test' then raise exception 'the address was not normalised'; end if;
  if v_j->>'team' <> 'The Regulars' then raise exception 'the invite did not name its team'; end if;
  v_checks := v_checks + 3;

  -- Re-inviting the same address retires the earlier link.
  v_j := ff_invite_co_owner(v_t1, 'friend@example.test');
  v_token2 := (v_j->>'token')::uuid;
  if v_token2 = v_token then raise exception 're-inviting reused the old token'; end if;
  if ff_invite_preview(v_token) is not null then raise exception 'a superseded co-owner link still previews'; end if;
  v_checks := v_checks + 2;

  -- The commissioner may, for any team with a manager.
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish)::text, true);
  v_j := ff_invite_co_owner(v_t2, 'cousin@example.test');
  if (v_j->>'token') is null then raise exception 'the commissioner could not invite a co-owner'; end if;
  v_invite_id := (select id from co_owner_invites where token = (v_j->>'token')::uuid);
  v_checks := v_checks + 1;

  -- But not for a team nobody has claimed: a co-owner sits beside a manager.
  begin
    perform ff_invite_co_owner(v_t3, 'anyone@example.test');
    raise exception 'a co-owner was invited to a team with no manager';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a co-owner was invited to a team with no manager' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- Another manager may not, and nor may a stranger.
  perform set_config('request.jwt.claims', json_build_object('sub', v_rival)::text, true);
  begin
    perform ff_invite_co_owner(v_t1, 'plant@example.test');
    raise exception 'a rival manager seated a co-owner on somebody else''s team';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a rival manager seated a co-owner on somebody else''s team' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform ff_invite_co_owner(v_t1, 'plant@example.test');
    raise exception 'a stranger seated a co-owner';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a stranger seated a co-owner' then raise; end if;
  end;
  v_checks := v_checks + 2;

  -- The manager's own address is refused, and so is something that is not one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  begin
    perform ff_invite_co_owner(v_t1, 'owner@example.test');
    raise exception 'the manager invited himself';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'the manager invited himself' then raise; end if;
  end;
  begin
    perform ff_invite_co_owner(v_t1, 'not an address');
    raise exception 'a non-address was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a non-address was accepted' then raise; end if;
  end;
  v_checks := v_checks + 2;

  -- ------------------------------------------------------------ the preview --
  -- Signed out, as /join is. The link says which team and which kind of seat.
  perform set_config('request.jwt.claims', null, true);
  v_j := ff_invite_preview(v_token2);
  if v_j->>'team' <> 'The Regulars' or v_j->>'role' <> 'co_owner' or v_j->>'manager' <> 'Owen' then
    raise exception 'a co-owner link previewed wrongly: %', v_j;
  end if;
  if ff_invite_preview(gen_random_uuid()) is not null then raise exception 'an invented token previewed'; end if;
  v_checks := v_checks + 2;

  -- A manager's link still says so, so the screen can tell them apart.
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish)::text, true);
  update teams set owner_email = 'nobody@example.test' where id = v_t3;
  v_token := ff_mint_invite(v_t3);
  v_j := ff_invite_preview(v_token);
  if v_j->>'role' <> 'manager' then raise exception 'a manager''s link lost its role'; end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- the seat list --
  -- The owner sees the outstanding address; a member of the league sees who
  -- sits there and not who has been asked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_j := ff_team_seats(v_t1);
  if not (v_j->>'can_manage')::boolean then raise exception 'the owner cannot manage his own seats'; end if;
  if jsonb_array_length(v_j->'invites') <> 1 or v_j->'invites'->0->>'email' <> 'friend@example.test' then
    raise exception 'the owner did not see his outstanding invite: %', v_j;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rival)::text, true);
  v_j := ff_team_seats(v_t1);
  if (v_j->>'can_manage')::boolean or jsonb_array_length(v_j->'invites') <> 0 then
    raise exception 'another manager saw the addresses on a team''s invites';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform ff_team_seats(v_t1);
    raise exception 'a stranger listed a team''s seats';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a stranger listed a team''s seats' then raise; end if;
  end;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------------ claiming it --
  -- Before the claim the friend is nobody here.
  perform set_config('request.jwt.claims', json_build_object('sub', v_friend)::text, true);
  if ff_is_member(v_league) then raise exception 'the friend was a member before claiming'; end if;
  if ff_link_me() is not null then raise exception 'ff_link_me found a team for the friend early'; end if;
  v_checks := v_checks + 2;

  v_row := ff_claim_invite(v_token2);
  if v_row.id <> v_t1 then raise exception 'claiming the co-owner link bound the wrong team'; end if;
  if not exists (select 1 from team_co_owners where team_id = v_t1 and user_id = v_friend and league_id = v_league) then
    raise exception 'no co-owner row was written';
  end if;
  if (select owner_id from teams where id = v_t1) <> v_owner then
    raise exception 'claiming a co-owner link moved the team';
  end if;
  if (select claimed_by from co_owner_invites where token = v_token2) is distinct from v_friend then
    raise exception 'the invite was not marked as claimed';
  end if;
  v_checks := v_checks + 4;

  -- Retrying is a no-op, the same as for a manager.
  v_row := ff_claim_invite(v_token2);
  if v_row.id <> v_t1 then raise exception 'a retried claim failed'; end if;
  if (select count(*) from team_co_owners where team_id = v_t1) <> 1 then raise exception 'a retried claim seated the friend twice'; end if;
  v_checks := v_checks + 2;

  -- A spent link is dead for anyone else.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform ff_claim_invite(v_token2);
    raise exception 'a spent co-owner link was claimed twice';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a spent co-owner link was claimed twice' then raise; end if;
  end;
  if ff_invite_preview(v_token2) is not null then raise exception 'a spent link still previews'; end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------- a co-owner is a manager here --
  perform set_config('request.jwt.claims', json_build_object('sub', v_friend)::text, true);
  if not ff_is_member(v_league) then raise exception 'a co-owner is not a member of the league'; end if;
  if not ff_is_member() then raise exception 'a co-owner is not a member of any league'; end if;
  if not ff_owns_team(v_t1) then raise exception 'a co-owner does not own the team'; end if;
  if ff_owns_team(v_t2) then raise exception 'a co-owner owns somebody else''s team'; end if;
  if ff_seat_team(v_league, v_friend) <> v_t1 then raise exception 'ff_seat_team does not find the co-owner''s seat'; end if;
  if ff_seat_team(v_other_league, v_friend) is not null then raise exception 'a seat leaked into another league'; end if;
  v_row := ff_link_me();
  if v_row.id <> v_t1 then raise exception 'ff_link_me does not load the co-owned team'; end if;
  v_checks := v_checks + 7;

  -- The manager's edit is the co-owner's too.
  v_row := ff_update_my_team('The Irregulars', null);
  if (select name from teams where id = v_t1) <> 'The Irregulars' then raise exception 'a co-owner could not rename the team'; end if;
  v_checks := v_checks + 1;

  -- The queue: his team yes, the rival's no. These two went through the
  -- in-place rewrite, so this is also the rewrite being exercised.
  perform ff_set_queue(v_t1, '{}'::uuid[]);
  begin
    perform ff_set_queue(v_t2, '{}'::uuid[]);
    raise exception 'a co-owner set another team''s queue';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a co-owner set another team''s queue' then raise; end if;
  end;
  perform ff_set_auto_draft(v_t1, true);
  if not (select auto_draft from teams where id = v_t1) then raise exception 'a co-owner could not switch on auto draft'; end if;
  v_checks := v_checks + 3;

  -- The house: a rewritten guard, and a rewritten "which team wrote this".
  perform ff_send_message(v_league, 'hello from the co-owner');
  v_j := ff_house_feed(v_league, null, 20);
  if v_j->'items'->0->>'author_team_id' is distinct from v_t1::text then
    raise exception 'the house did not attribute a co-owner''s line to his team: %', v_j->'items'->0;
  end if;
  if not (v_j->'items'->0->>'mine')::boolean then raise exception 'the house did not mark a co-owner''s own line as his'; end if;
  v_checks := v_checks + 2;

  -- The private board, through the policy rather than a function: a row on
  -- his team's queue is visible to him as `authenticated`, under RLS.
  insert into draft_queue (team_id, player_id, rank)
  select v_t1, id, 1 from players limit 1;
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from draft_queue where team_id = v_t1;
  perform set_config('role', 'postgres', true);
  if v_n <> 1 then
    raise exception 'the draft_queue policy hides a co-owner''s own board';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------- one seat per league --
  -- The rival already runs a team here: the cousin's link is not his to take.
  perform set_config('request.jwt.claims', json_build_object('sub', v_rival)::text, true);
  v_token := (select token from co_owner_invites where id = v_invite_id);
  -- (he owns The Rivals, and the link is for The Rivals — that is his own seat,
  -- which is a no-op, so point the link at the other team to test the rule)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_j := ff_invite_co_owner(v_t1, 'cousin@example.test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_rival)::text, true);
  begin
    perform ff_claim_invite((v_j->>'token')::uuid);
    raise exception 'a manager took a second seat in his own league';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager took a second seat in his own league' then raise; end if;
    if v_err not like '%already hold a seat%' then raise exception 'wrong refusal for a second seat: %', v_err; end if;
  end;
  if exists (select 1 from team_co_owners where user_id = v_rival) then raise exception 'the second seat was written anyway'; end if;
  v_checks := v_checks + 2;

  -- And a co-owner may not take a second one either.
  perform set_config('request.jwt.claims', json_build_object('sub', v_friend)::text, true);
  begin
    perform ff_claim_invite(v_token);
    raise exception 'a co-owner took a second seat';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a co-owner took a second seat' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- A co-owner may not seat further co-owners.
  begin
    perform ff_invite_co_owner(v_t1, 'chain@example.test');
    raise exception 'a co-owner invited a co-owner';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a co-owner invited a co-owner' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------ withdrawing a link --
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform ff_cancel_co_owner_invite(v_invite_id);
    raise exception 'a stranger withdrew an invite';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a stranger withdrew an invite' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rival)::text, true);
  if not ff_cancel_co_owner_invite(v_invite_id) then raise exception 'the owner could not withdraw an invite'; end if;
  if exists (select 1 from co_owner_invites where id = v_invite_id) then raise exception 'the withdrawn invite is still there'; end if;
  if ff_cancel_co_owner_invite(v_invite_id) then raise exception 'withdrawing twice reported success'; end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------- leaving the seat --
  perform set_config('request.jwt.claims', json_build_object('sub', v_rival)::text, true);
  begin
    perform ff_remove_co_owner(v_t1, v_friend);
    raise exception 'a rival removed somebody else''s co-owner';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a rival removed somebody else''s co-owner' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- The co-owner may walk away himself...
  perform set_config('request.jwt.claims', json_build_object('sub', v_friend)::text, true);
  if not ff_remove_co_owner(v_t1, v_friend) then raise exception 'a co-owner could not leave'; end if;
  if ff_is_member(v_league) then raise exception 'a departed co-owner is still a member'; end if;
  if ff_link_me() is not null then raise exception 'a departed co-owner still loads the team'; end if;
  v_checks := v_checks + 3;

  -- ...and the owner may show him the door. Seat him again to prove it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_j := ff_invite_co_owner(v_t1, 'friend@example.test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_friend)::text, true);
  perform ff_claim_invite((v_j->>'token')::uuid);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_j := ff_team_seats(v_t1);
  if jsonb_array_length(v_j->'co_owners') <> 1 or v_j->'co_owners'->0->>'name' <> 'Frankie' then
    raise exception 'the seat list did not show the co-owner by name: %', v_j;
  end if;
  if not ff_remove_co_owner(v_t1, v_friend) then raise exception 'the owner could not remove a co-owner'; end if;
  if exists (select 1 from team_co_owners where team_id = v_t1) then raise exception 'the removed co-owner is still seated'; end if;
  v_checks := v_checks + 3;

  -- -------------------------------------------- nothing asks the old way --
  -- The regression the whole file is for. Any function that still decides
  -- ownership by owner_id alone, outside the handful that mean the owner
  -- specifically, has been redefined from a body older than the co-owner
  -- migration and will refuse a co-owner without an error anybody sees.
  select string_agg(p.proname, ', ') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '(owner_id\s*=\s*(v_uid|auth\.uid\(\))|t\.owner_id\s*=\s*(lm\.author_id|ae\.actor_id|pl\.author_id))'
     and p.proname not in ('ff_is_member', 'ff_owns_team', 'ff_link_me', 'ff_update_my_team',
                           'ff_claim_invite', 'ff_seat_team', 'ff_invite_co_owner',
                           'ff_cancel_co_owner_invite', 'ff_remove_co_owner', 'ff_team_seats');
  if v_left is not null then
    raise exception '% decide(s) ownership by owner_id alone, which locks co-owners out — use public.ff_seat_team', v_left;
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and coalesce(qual, '') || coalesce(with_check, '') like '%owner_id%'
  ) then
    raise exception 'a policy decides ownership by owner_id alone — use public.ff_owns_team';
  end if;
  v_checks := v_checks + 2;

  -- ---------------------------------------------------------- who may call --
  if has_function_privilege('anon', 'public.ff_invite_co_owner(uuid, text)', 'execute')
  or has_function_privilege('anon', 'public.ff_cancel_co_owner_invite(uuid)', 'execute')
  or has_function_privilege('anon', 'public.ff_remove_co_owner(uuid, uuid)', 'execute')
  or has_function_privilege('anon', 'public.ff_team_seats(uuid)', 'execute') then
    raise exception 'anon can reach the co-owner functions';
  end if;
  if not has_function_privilege('authenticated', 'public.ff_invite_co_owner(uuid, text)', 'execute')
  or not has_function_privilege('authenticated', 'public.ff_team_seats(uuid)', 'execute') then
    raise exception 'a signed-in manager cannot reach the co-owner functions the app calls';
  end if;
  if has_function_privilege('authenticated', 'public.ff_seat_team(uuid, uuid)', 'execute') then
    raise exception 'ff_seat_team is callable by a manager; it is an internal helper';
  end if;
  if has_table_privilege('authenticated', 'public.co_owner_invites', 'select') then
    raise exception 'a manager can read the invite table, tokens and addresses included';
  end if;
  if has_table_privilege('authenticated', 'public.team_co_owners', 'insert')
  or has_table_privilege('authenticated', 'public.team_co_owners', 'delete') then
    raise exception 'a manager can write team_co_owners directly';
  end if;
  v_checks := v_checks + 5;

  raise notice 'co-owners: % checks passed', v_checks;
end $$;

rollback;
