-- ============================================================================
-- Polls: one vote each, and no peeking.
--
-- The check worth writing this file for is the withheld split. A poll that
-- shows the running score before you answer measures conformity rather than
-- opinion, so ff_poll_for returns NULL counts until the reader has voted or the
-- poll has closed — and a null is not a zero, because a reader would take a
-- zero for a number.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other uuid;
  v_uid_a uuid; v_uid_b uuid; v_uid_c uuid; v_uid_out uuid;
  v_poll uuid; v_closed uuid; v_far uuid;
  v_o1 uuid; v_o2 uuid; v_far_o uuid;
  v_j jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('pa@example.test')  returning id into v_uid_a;
  insert into auth.users (email) values ('pb@example.test')  returning id into v_uid_b;
  insert into auth.users (email) values ('pc@example.test')  returning id into v_uid_c;
  insert into auth.users (email) values ('po@example.test')  returning id into v_uid_out;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Poll Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Elsewhere', 2026, v_uid_out, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, owner_id) values (v_league, 'Alpha', v_uid_a);
  insert into teams (league_id, name, owner_id) values (v_league, 'Bravo', v_uid_b);
  insert into teams (league_id, name, owner_id) values (v_league, 'Charlie', v_uid_c);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);

  -- ------------------------------------------------------------- asking --
  v_poll := ff_create_poll(v_league, '  Who wins the Chase trade?  ',
                           array['Alpha','Bravo','Nobody'], null);
  if v_poll is null then raise exception 'the poll was not created'; end if;
  if (select question from polls where id = v_poll) <> 'Who wins the Chase trade?' then
    raise exception 'the question was not trimmed: "%"', (select question from polls where id = v_poll);
  end if;
  if (select count(*) from poll_options where poll_id = v_poll) <> 3 then
    raise exception 'expected three answers, got %',
      (select count(*) from poll_options where poll_id = v_poll);
  end if;
  v_checks := v_checks + 3;

  -- A poll needs a real choice. One answer, or one answer plus blanks, is a
  -- statement with a button on it.
  begin
    perform ff_create_poll(v_league, 'Only one?', array['Yes','  ',''], null);
    raise exception 'a poll was created with one real answer';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a poll was created with one real answer' then raise; end if;
    if v_err not like '%at least two%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- Duplicates collapse rather than making a poll you cannot read.
  begin
    perform ff_create_poll(v_league, 'Dupes', array['Same','Same'], null);
    raise exception 'a poll was created from one answer written twice';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a poll was created from one answer written twice' then raise; end if;
  end;
  v_checks := v_checks + 1;

  begin
    perform ff_create_poll(v_league, 'Past', array['A','B'], now() - interval '1 hour');
    raise exception 'a poll closed before it opened';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a poll closed before it opened' then raise; end if;
    if v_err not like '%already passed%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  select id into v_o1 from poll_options where poll_id = v_poll and seq = 1;
  select id into v_o2 from poll_options where poll_id = v_poll and seq = 2;

  -- --------------------------------------------- THE ONE: no peeking --
  -- Alpha has not voted. He may see that a poll exists and how many have
  -- answered, and NOT how they answered.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_b)::text, true);
  perform ff_vote(v_poll, v_o1);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_c)::text, true);
  perform ff_vote(v_poll, v_o1);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  v_j := ff_poll_for(v_poll);

  if (v_j->>'revealed')::boolean then raise exception 'the split was shown to somebody who had not voted'; end if;
  if (v_j->>'votes')::int <> 2 then raise exception 'the turnout was %, expected 2', v_j->>'votes'; end if;
  if v_j->'options'->0->>'count' is not null then
    raise exception 'a count leaked before voting: %', v_j->'options'->0->>'count';
  end if;
  if v_j->>'my_option' is not null then raise exception 'a non-voter was shown a vote'; end if;
  v_checks := v_checks + 4;

  -- Voting reveals it, and only then.
  perform ff_vote(v_poll, v_o2);
  v_j := ff_poll_for(v_poll);
  if not (v_j->>'revealed')::boolean then raise exception 'voting did not reveal the split'; end if;
  if (v_j->'options'->0->>'count')::int <> 2 then
    raise exception 'the leading answer counted %', v_j->'options'->0->>'count';
  end if;
  if (v_j->'options'->1->>'count')::int <> 1 then
    raise exception 'my own answer counted %', v_j->'options'->1->>'count';
  end if;
  if (v_j->>'my_option')::uuid <> v_o2 then raise exception 'my vote was not reported back'; end if;
  if not (v_j->'options'->1->>'mine')::boolean then raise exception 'my answer was not marked mine'; end if;
  v_checks := v_checks + 5;

  -- ------------------------------------------------- one each, changeable --
  perform ff_vote(v_poll, v_o1);
  if (select count(*) from poll_votes where poll_id = v_poll and user_id = v_uid_a) <> 1 then
    raise exception 'changing a vote left two';
  end if;
  if (select count(*) from poll_votes where poll_id = v_poll) <> 3 then
    raise exception 'the poll holds % votes for three managers',
      (select count(*) from poll_votes where poll_id = v_poll);
  end if;
  v_j := ff_poll_for(v_poll);
  if (v_j->'options'->0->>'count')::int <> 3 then
    raise exception 'after moving my vote the leader counted %', v_j->'options'->0->>'count';
  end if;
  v_checks := v_checks + 3;

  -- ---------------------------------------------------------- the refusals --
  -- An answer from a different poll.
  v_closed := ff_create_poll(v_league, 'Another', array['X','Y'], null);
  begin
    perform ff_vote(v_poll, (select id from poll_options where poll_id = v_closed limit 1));
    raise exception 'a vote used an answer from another poll';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a vote used an answer from another poll' then raise; end if;
    if v_err not like '%not on this poll%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_checks := v_checks + 1;

  -- A closed poll takes no more votes, and shows its split to everybody.
  update polls set closes_at = now() - interval '1 minute' where id = v_closed;
  begin
    perform ff_vote(v_closed, (select id from poll_options where poll_id = v_closed limit 1));
    raise exception 'a closed poll took a vote';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a closed poll took a vote' then raise; end if;
    if v_err not like '%has closed%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  v_j := ff_poll_for(v_closed);
  if not (v_j->>'revealed')::boolean then
    raise exception 'a closed poll still hid its result from somebody who never voted';
  end if;
  if not (v_j->>'closed')::boolean then raise exception 'a closed poll did not say so'; end if;
  v_checks := v_checks + 3;

  -- An outsider can neither ask nor answer.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_out)::text, true);
  begin
    perform ff_vote(v_poll, v_o1);
    raise exception 'an outsider voted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider voted' then raise; end if;
    if v_err not like '%not a member%' then raise exception 'wrong refusal: %', v_err; end if;
  end;
  begin
    perform ff_create_poll(v_league, 'Mine now', array['A','B'], null);
    raise exception 'an outsider asked a question of a league he is not in';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider asked a question of a league he is not in' then raise; end if;
  end;
  v_checks := v_checks + 2;

  -- ------------------------------------------------- the ballot stays secret --
  -- poll_votes records who voted for what, because a vote has to be movable.
  -- Nothing reads it back per person: the policy shows a manager his own row
  -- and no other.
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);
  set local role authenticated;
  if (select count(*) from poll_votes where poll_id = v_poll) <> 1 then
    raise exception 'a manager could read % ballots, expected only his own',
      (select count(*) from poll_votes where poll_id = v_poll);
  end if;
  reset role;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------- a poll in the feed --
  v_j := ff_house_feed(v_league, null, 50);
  if not exists (
    select 1 from jsonb_array_elements(v_j->'items') x
     where x->>'source' = 'poll' and (x->>'id')::uuid = v_poll
       and x->'poll'->>'question' = 'Who wins the Chase trade?'
  ) then
    raise exception 'the poll did not reach the House feed with its question';
  end if;
  v_checks := v_checks + 1;

  -- And it is reactable, like every other line in the room.
  perform ff_react(v_league, 'poll', v_poll, '🔥');
  if jsonb_array_length(ff_reactions_for('poll', v_poll)) <> 1 then
    raise exception 'a poll could not be reacted to';
  end if;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may write --
  if has_table_privilege('authenticated', 'public.poll_votes', 'insert') then
    raise exception 'a manager can stuff the ballot box directly';
  end if;
  if has_table_privilege('authenticated', 'public.polls', 'insert') then
    raise exception 'a manager can create polls directly, bypassing every check';
  end if;
  if has_function_privilege('anon', 'public.ff_vote(uuid,uuid)', 'execute') then
    raise exception 'anon can vote';
  end if;
  v_checks := v_checks + 3;

  raise notice 'polls: % checks passed', v_checks;
end $$;

rollback;
