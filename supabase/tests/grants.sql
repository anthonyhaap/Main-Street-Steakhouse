-- ============================================================================
-- Who may call what.
--
-- Every other test in this directory asks whether a function does the right
-- thing. This one asks a question none of them could: whether the wrong person
-- can reach it at all.
--
-- It exists because twenty functions were callable by any signed-in manager on
-- the live project while every check here passed — ff_run_waivers and
-- ff_process_waivers among them, so a manager could settle the league's waivers
-- whenever he liked. The cause was not a missing revoke in any one migration.
-- It was that a Supabase project carries
--
--   alter default privileges in schema public grant execute on functions
--     to postgres, anon, authenticated, service_role
--
-- so a function is granted to `authenticated` the instant it is created, and
-- the house style of `revoke ... from public, anon` never took that back. The
-- throwaway Postgres this replays into had no such default, so it showed the
-- grants the migrations intended rather than the ones production would have.
--
-- scripts/replay/preflight.sql now installs those default privileges, which is
-- what makes the assertions below meaningful: they run against a database that
-- hands out EXECUTE the way the real one does. A new migration that forgets to
-- revoke fails here instead of shipping.
--
-- Adding a function to the list is a deliberate act. If a screen genuinely
-- needs to call one of these, take it out and say why in the commit.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_name   text;
  v_sig    text;
  v_bad    text[] := '{}';
  v_miss   text[] := '{}';
  v_checks integer := 0;

  -- Cron entries, loaders, and internals. None of these is called from src/ —
  -- the SECURITY DEFINER functions that use them run as the definer, so a
  -- manager never needs the grant.
  v_service_only text[] := array[
    'ff_run_waivers', 'ff_process_waivers', 'ff_place_unordered_teams', 'ff_validate_trade',
    'ff_roll_rosters', 'ff_materialize_roster', 'ff_refresh_wire', 'ff_refresh_projections',
    'ff_rebuild_season_projections', 'ff_load_season_projections', 'ff_load_sleeper_projections',
    'ff_load_espn_injuries', 'ff_load_espn_news', 'ff_backfill_bye_weeks',
    'ff_player_season', 'ff_recap_body', 'ff_injury_severity', 'ff_height_inches',
    'ff_club', 'ff_who',
    'ff_poll_live', 'ff_post_weekly_recaps', 'ff_resolve_matchup_challenges',
    'ff_settle_recent_weeks', 'ff_all_games', 'ff_all_sides', 'ff_streak',
    'ff_audit_challenge_change'
  ];

  -- A representative handful the screens really do call. Asserted so that a
  -- blanket `revoke ... from authenticated` cannot "fix" the test by locking
  -- the managers out of their own app.
  v_manager_facing text[] := array[
    'ff_team_hub', 'ff_set_lineup', 'ff_add_drop', 'ff_claim_waiver', 'ff_waiver_board',
    'ff_propose_trade', 'ff_respond_trade', 'ff_trade_desk', 'ff_briefing', 'ff_scoreboard'
  ];
begin
  -- ------------------------------------- nobody signed in may call these --
  foreach v_name in array v_service_only loop
    for v_sig in
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
         and has_function_privilege('authenticated', p.oid, 'execute')
    loop
      v_bad := v_bad || v_sig;
    end loop;
    v_checks := v_checks + 1;
  end loop;

  if array_length(v_bad, 1) is not null then
    raise exception 'authenticated can execute % function(s) that are service-role only: %',
      array_length(v_bad, 1), array_to_string(v_bad, ', ');
  end if;

  -- anon reaches exactly one thing, and it is not in this list.
  foreach v_name in array v_service_only loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
         and has_function_privilege('anon', p.oid, 'execute')
    ) then
      raise exception 'anon can execute %, which is service-role only', v_name;
    end if;
    v_checks := v_checks + 1;
  end loop;

  -- ------------------------------------- and the app still works --
  foreach v_name in array v_manager_facing loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
         and has_function_privilege('authenticated', p.oid, 'execute')
    ) then
      v_miss := v_miss || v_name;
    end if;
    v_checks := v_checks + 1;
  end loop;

  if array_length(v_miss, 1) is not null then
    raise exception 'a signed-in manager cannot execute %, which the app calls: %',
      array_length(v_miss, 1), array_to_string(v_miss, ', ');
  end if;

  -- The preflight must actually be modelling production, or none of the above
  -- proves anything: it would pass on a database that grants nothing by default.
  if not exists (
    select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
     where n.nspname = 'public' and d.defaclobjtype = 'f'
       and array_to_string(d.defaclacl, ',') like '%authenticated=X%'
  ) then
    raise exception 'this database has no default EXECUTE grant to authenticated, so the '
      'checks above are vacuous — scripts/replay/preflight.sql is meant to install one';
  end if;
  v_checks := v_checks + 1;

  raise notice 'grants: % checks passed', v_checks;
end $$;

rollback;
