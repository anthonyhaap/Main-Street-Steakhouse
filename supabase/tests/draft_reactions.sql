-- ============================================================================
-- Reacting to a pick.
--
-- The interesting part is not the tally, which the House already proved works;
-- it is that widening a closed set has two halves. `source` is checked by a
-- constraint on the table AND by a CASE inside ff_react, and the last time a
-- source was added the CASE was missed, so every write was accepted by the
-- guard and then refused as "no such line in this league". Both halves are
-- asserted here.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other uuid;
  v_ada uuid; v_bo uuid;
  v_team uuid; v_other_team uuid;
  v_draft uuid; v_other_draft uuid;
  v_pick uuid; v_other_pick uuid;
  v_player uuid; v_player2 uuid;
  v_j jsonb; v_err text;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('ada@example.test') returning id into v_ada;
  insert into auth.users (email) values ('bo@example.test')  returning id into v_bo;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Reaction Test', 2026, v_ada, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Somewhere Else', 2026, v_bo, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'Alpha', 'Ada', v_ada) returning id into v_team;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_other, 'Bravo', 'Bo', v_bo) returning id into v_other_team;

  insert into drafts (league_id, status) values (v_league, 'active') returning id into v_draft;
  insert into drafts (league_id, status) values (v_other,  'active') returning id into v_other_draft;

  select id into v_player  from players limit 1;
  select id into v_player2 from players offset 1 limit 1;
  if v_player is null or v_player2 is null then
    raise notice 'draft reactions: no players seeded, nothing to react to';
    return;
  end if;

  insert into draft_picks (draft_id, team_id, player_id, pick_number, round)
  values (v_draft, v_team, v_player, 1, 1) returning id into v_pick;
  insert into draft_picks (draft_id, team_id, player_id, pick_number, round)
  values (v_other_draft, v_other_team, v_player2, 1, 1) returning id into v_other_pick;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ada)::text, true);

  -- A draft nobody has reacted to yet is an empty object, not a null: the
  -- board has to render before anybody has said anything, and a league gets
  -- exactly one draft so there is no quieter one to ask.
  if ff_draft_reactions(v_draft) <> '{}'::jsonb then
    raise exception 'a draft with no reactions invented some';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------ both halves work --
  -- The guard accepts 'pick', and so does the existence CASE behind it. A
  -- widened constraint with an unwidened CASE fails exactly here.
  v_j := ff_react(v_league, 'pick', v_pick, '🔥');
  if (v_j->>'count')::int <> 1 or (v_j->>'mine')::boolean is not true then
    raise exception 'the first reaction to a pick came back as %', v_j;
  end if;
  v_checks := v_checks + 1;

  -- It is a toggle, the same as everywhere else.
  v_j := ff_react(v_league, 'pick', v_pick, '🔥');
  if (v_j->>'count')::int <> 0 or (v_j->>'mine')::boolean is not false then
    raise exception 'pressing twice did not take it back: %', v_j;
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------------ the tally --
  perform ff_react(v_league, 'pick', v_pick, '🔥');
  perform set_config('request.jwt.claims', json_build_object('sub', v_bo)::text, true);
  -- Bo is not in this league, so his reaction must be refused rather than
  -- counted: a draft is the one screen the whole league is watching at once.
  begin
    perform ff_react(v_league, 'pick', v_pick, '🔥');
    raise exception 'an outsider reacted to another league''s pick';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an outsider reacted to another league''s pick' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- And a member of this league cannot reach into another league's draft by
  -- passing its pick id with their own league id.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ada)::text, true);
  begin
    perform ff_react(v_league, 'pick', v_other_pick, '🔥');
    raise exception 'a pick from another league was accepted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a pick from another league was accepted' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- -------------------------------------------------- the whole board once --
  perform ff_react(v_league, 'pick', v_pick, '💀');
  v_j := ff_draft_reactions(v_draft);

  if v_j->(v_pick::text) is null then
    raise exception 'the draft''s reactions came back without the pick that has them';
  end if;
  if jsonb_array_length(v_j->(v_pick::text)) <> 2 then
    raise exception 'expected two emoji on the pick, got %', v_j->(v_pick::text);
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_j->(v_pick::text)) e
     where e->>'emoji' = '🔥' and (e->>'count')::int = 1 and (e->>'mine')::boolean
  ) then
    raise exception 'the tally lost who is in it: %', v_j->(v_pick::text);
  end if;
  v_checks := v_checks + 3;

  -- Another league's draft does not come back empty — it does not come back.
  -- An empty answer would confirm the draft exists to somebody with no seat
  -- at that table.
  begin
    perform ff_draft_reactions(v_other_draft);
    raise exception 'another league''s draft answered at all';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'another league''s draft answered at all' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ---------------------------------------------------------- who may read --
  perform set_config('request.jwt.claims', null, true);
  if has_function_privilege('anon', 'public.ff_draft_reactions(uuid)', 'execute')
  or has_function_privilege('anon', 'public.ff_react(uuid,text,uuid,text)', 'execute') then
    raise exception 'anon can reach the draft reactions';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------- the constraint itself --
  -- The closed set is the point: a typo in a client has to be a rejected write
  -- rather than a reaction nobody can ever see again.
  begin
    insert into reactions (league_id, source, target_id, user_id, emoji)
    values (v_league, 'picks', v_pick, v_ada, '🔥');
    raise exception 'the source column accepted a value nothing reads';
  exception when check_violation then
    null;
  end;
  v_checks := v_checks + 1;

  raise notice 'draft reactions: % checks passed', v_checks;
end $$;

rollback;
