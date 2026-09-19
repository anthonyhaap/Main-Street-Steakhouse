-- ============================================================================
-- Weekly awards: one activity_events card per fact the week actually has,
-- posted alongside the Special and never twice.
--
-- Bench and player-of-the-week both read roster_points, which this fixture
-- does not seed — recap_push.sql notes the same gap and leaves that clause to
-- production. What is seeded here is enough to exercise the other four: the
-- high score, the low score, a blowout and a nailbiter, plus the one thing
-- specific to this migration — that a second publish adds no second set of
-- cards, riding on the same recap-row lock the message already trusted.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_uid_a uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid;
  v_out jsonb;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('wa@example.test') returning id into v_uid_a;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Awards Test', 2026, v_uid_a, '["QB"]'::jsonb, '{}'::jsonb) returning id into v_league;

  insert into teams (league_id, name, manager_name, owner_id) values (v_league, 'Team A', 'Ada', v_uid_a) returning id into v_a;
  insert into teams (league_id, name, manager_name) values (v_league, 'Team B', 'Bo')  returning id into v_b;
  insert into teams (league_id, name, manager_name) values (v_league, 'Team C', 'Cy')  returning id into v_c;
  insert into teams (league_id, name, manager_name) values (v_league, 'Team D', 'Di')  returning id into v_d;
  insert into teams (league_id, name, manager_name) values (v_league, 'Team E', 'Ed')  returning id into v_e;
  insert into teams (league_id, name, manager_name) values (v_league, 'Team F', 'Fi')  returning id into v_f;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team, kickoff_at, status)
  values ('award-w1', 2026, 2, 1, 'SEA', 'NE', now() - interval '6 days', 'post');

  -- A blows out B (margin 60, well past the 25-point threshold); C edges D by
  -- 5 (right at the nailbiter threshold, and a different winner than the
  -- blowout so both cards are worth posting); E and F round out the week with
  -- the week's high (Ada, 150) and low (Fi, 60) at its edges. Three games, so
  -- the low score clears ff_recap_body's own "league big enough" guard.
  insert into matchups (league_id, week, home_team_id, away_team_id, home_points, away_points) values
    (v_league, 1, v_a, v_b, 150.0, 90.0),
    (v_league, 1, v_c, v_d, 100.0, 95.0),
    (v_league, 1, v_e, v_f, 70.0, 60.0);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_a)::text, true);

  -- ----------------------------------------------------------- the publish --
  v_out := ff_publish_recap(v_league, 1);
  if not (v_out->>'posted')::boolean then raise exception 'the Special was not posted: %', v_out; end if;
  if (v_out->>'awards')::int <> 4 then raise exception 'expected 4 award cards, got %', v_out->>'awards'; end if;
  v_checks := v_checks + 2;

  if (select count(*) from activity_events where league_id = v_league and event_type = 'award') <> 4 then
    raise exception 'the league does not carry 4 award cards';
  end if;
  v_checks := v_checks + 1;

  if not exists (select 1 from activity_events
                  where league_id = v_league and event_type = 'award'
                    and headline = 'Ada put up the week''s best score') then
    raise exception 'no high-score card for Ada';
  end if;
  if not exists (select 1 from activity_events
                  where league_id = v_league and event_type = 'award'
                    and headline = 'Fi had the week''s low score') then
    raise exception 'no low-score card for Fi';
  end if;
  if not exists (select 1 from activity_events
                  where league_id = v_league and event_type = 'award'
                    and headline = 'Ada blew out Bo') then
    raise exception 'no blowout card for Ada over Bo';
  end if;
  if not exists (select 1 from activity_events
                  where league_id = v_league and event_type = 'award'
                    and headline = 'Cy escaped Di') then
    raise exception 'no nailbiter card for Cy over Di';
  end if;
  v_checks := v_checks + 4;

  -- Every card points back at the recap post, and carries the week in its
  -- detail so it stands on its own in the feed, away from the prose.
  if exists (select 1 from activity_events
              where league_id = v_league and event_type = 'award'
                and (source_type is distinct from 'recap' or source_id is distinct from (v_out->>'message_id')::uuid
                     or detail not like '%Week 1%')) then
    raise exception 'an award card was not attributed back to the recap';
  end if;
  v_checks := v_checks + 1;

  -- They are ordinary 'event' lines in the House, same as a trade or a waiver.
  if (select count(*) from jsonb_array_elements(
        (ff_house_feed(v_league, null, 100))->'items') x
       where x->>'source' = 'event' and x->>'kind' = 'award') <> 4 then
    raise exception 'the award cards did not surface in the House feed';
  end if;
  v_checks := v_checks + 1;

  -- ------------------------------------------------------- twice is once --
  v_out := ff_publish_recap(v_league, 1);
  if (v_out->>'posted')::boolean then raise exception 'the Special was posted twice'; end if;
  if (select count(*) from activity_events where league_id = v_league and event_type = 'award') <> 4 then
    raise exception 'a second publish added a second set of award cards';
  end if;
  v_checks := v_checks + 2;

  raise notice 'weekly awards: % checks passed', v_checks;
end $$;

rollback;
