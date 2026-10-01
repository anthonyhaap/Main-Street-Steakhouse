-- ============================================================================
-- Steakhouse Sunday, phase 3: reactions, talk and activity.
--
-- `20261002120000_sunday_social` teaches three existing things one more
-- trick each: `ff_react` a 'sunday' stream, the chat a message about a
-- moment, and `ff_sunday` the league's activity. What can go wrong is what
-- always goes wrong with a social feature in a private league — a reaction on
-- another league's moment, a context line the browser made up, a message from
-- someone without a seat — so that is what this checks, alongside the happy
-- path.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid; v_other uuid;
  v_ada uuid; v_bo uuid; v_stranger uuid;
  v_home uuid; v_away uuid; v_m uuid;
  v_ev uuid; v_foreign uuid;
  v_j jsonb; v_e jsonb; v_msg league_messages%rowtype;
  v_checks integer := 0;
  v_week constant integer := 6;
  v_failed boolean;
begin
  insert into auth.users (email) values ('ss-ada@example.test') returning id into v_ada;
  insert into auth.users (email) values ('ss-bo@example.test')  returning id into v_bo;
  insert into auth.users (email) values ('ss-x@example.test')   returning id into v_stranger;

  insert into leagues (name, season, team_count, commissioner_id, roster_slots, settings)
  values ('Social Test', 2026, 2, v_ada, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;
  insert into leagues (name, season, team_count, commissioner_id, roster_slots, settings)
  values ('Elsewhere', 2026, 2, v_stranger, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_other;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Alpha', 'Ada Lovelace', v_ada)
  returning id into v_home;
  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Bravo', 'Bo', v_bo)
  returning id into v_away;
  insert into matchups (league_id, week, home_team_id, away_team_id) values (v_league, v_week, v_home, v_away)
  returning id into v_m;

  -- A moment, as the detector would have written it.
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, priority,
                             matchup_id, team_id, opponent_team_id, old_score, new_score,
                             opp_old_score, opp_new_score, lead_change, headline, detail)
  values (v_league, 2026, v_week, 'lead:test:1', 'lead_change', 3, 35, v_m, v_home, v_away,
          10, 117.3, 114.8, 114.8, true, 'Ada takes the lead over Bo',
          jsonb_build_object('who', 'Ada', 'opp', 'Bo'))
  returning id into v_ev;
  insert into sunday_events (league_id, season, week, dedupe_key, event_type, level, headline)
  values (v_other, 2026, v_week, 'x', 'final', 1, 'Somebody else''s final') returning id into v_foreign;

  -- ------------------------------------------------------------ reactions --
  perform set_config('request.jwt.claims', json_build_object('sub', v_ada)::text, true);
  v_j := public.ff_react(v_league, 'sunday', v_ev, '😂');
  if not (v_j->>'mine')::boolean or (v_j->>'count')::int <> 1 then raise exception 'react on a moment failed: %', v_j; end if;
  v_j := public.ff_react(v_league, 'sunday', v_ev, '😡');
  if (v_j->>'count')::int <> 1 then raise exception '😡 is in the palette now'; end if;
  v_j := public.ff_react(v_league, 'sunday', v_ev, '😡');
  if (v_j->>'mine')::boolean or (v_j->>'count')::int <> 0 then raise exception 'a second tap takes it back'; end if;
  v_checks := v_checks + 3;

  v_failed := false;
  begin perform public.ff_react(v_league, 'sunday', v_foreign, '😂');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'reacted to another league''s moment'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  v_failed := false;
  begin perform public.ff_react(v_league, 'sunday', v_ev, '😂');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a stranger reacted in a league he has no seat in'; end if;
  v_checks := v_checks + 2;

  -- ----------------------------------------------------------------- talk --
  perform set_config('request.jwt.claims', json_build_object('sub', v_bo)::text, true);
  v_j := public.ff_talk_about(v_league, v_ev, '  absolute fraud  ');
  select * into v_msg from league_messages where id = (v_j->>'id')::uuid;
  if v_msg.body <> E'🔥 Ada just took the lead over Bo, 117.3–114.8.\nabsolute fraud' then
    raise exception 'talk body wrong: %', v_msg.body;
  end if;
  if v_msg.sunday_event_id <> v_ev or v_msg.author_id <> v_bo or v_msg.kind <> 'manager' then
    raise exception 'talk not linked to its moment and its author';
  end if;
  v_checks := v_checks + 2;

  v_failed := false;
  begin perform public.ff_talk_about(v_league, v_ev, '   ');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'talk with nothing said was posted'; end if;

  v_failed := false;
  begin perform public.ff_talk_about(v_league, v_ev, repeat('x', 990));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'talk over 1000 characters with its context was posted'; end if;

  v_failed := false;
  begin perform public.ff_talk_about(v_league, v_foreign, 'hi');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'talked about another league''s moment'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  v_failed := false;
  begin perform public.ff_talk_about(v_league, v_ev, 'hi');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a stranger talked in a league he has no seat in'; end if;
  v_checks := v_checks + 4;

  -- ------------------------------------------------------------- activity --
  -- A challenge, proposed. The audit trigger writes its first row.
  insert into challenges (league_id, challenger_id, opponent_id, title, terms, matchup_id)
  values (v_league, v_bo, v_ada, 'Bo beats Ada', 'Higher score wins.', v_m);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ada)::text, true);
  v_j := public.ff_sunday(v_league, v_week);

  v_e := (select e from jsonb_array_elements(v_j->'events') e where (e->>'id')::uuid = v_ev);
  if v_e->'reactions' <> '[{"emoji":"😂","count":1,"mine":true}]'::jsonb or (v_e->>'talk')::int <> 1 then
    raise exception 'event did not carry its reactions and talk: % / %', v_e->'reactions', v_e->'talk';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_j->'activity') a
                  where a->>'kind' = 'challenge' and a->>'verb' = 'proposed'
                    and a->>'who' = 'Bo' and a->>'opp' = 'Ada' and a->>'title' = 'Bo beats Ada') then
    raise exception 'the challenge did not reach the activity: %', v_j->'activity';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_j->'activity') a
                  where a->>'kind' = 'chat' and a->>'who' = 'Bo' and (a->>'sunday_event_id')::uuid = v_ev) then
    raise exception 'talk about a moment did not reach the activity';
  end if;
  -- Another league's moment never appears here.
  if exists (select 1 from jsonb_array_elements(v_j->'events') e where (e->>'id')::uuid = v_foreign) then
    raise exception 'another league''s event leaked into this one';
  end if;
  perform set_config('request.jwt.claims', '', true);
  v_checks := v_checks + 4;

  -- ---------------------------------------------------------------- doors --
  if has_function_privilege('anon', 'public.ff_talk_about(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.ff_sunday_context(uuid)', 'execute') then
    raise exception 'talk is reachable without a seat, or the context writer from the browser';
  end if;
  v_checks := v_checks + 1;

  raise notice 'sunday social: % checks passed', v_checks;
end $$;

rollback;
