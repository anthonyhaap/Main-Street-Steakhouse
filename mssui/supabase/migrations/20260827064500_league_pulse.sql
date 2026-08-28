-- ============================================================================
-- ff_league_pulse — one call that tells the commissioner everything.
--
-- Returns league state, manager join status, a draft-readiness checklist,
-- data-freshness telemetry, pg_cron job health, the season calendar and recent
-- activity as a single jsonb payload.
--
-- SECURITY DEFINER so it can read operational tables (ingest_log, cron.*) that
-- members cannot select directly. Membership is re-checked on entry: you must
-- own a team in this league, or be its commissioner. auth.uid() IS NULL is the
-- service-role escape hatch.
-- ============================================================================

create or replace function public.ff_league_pulse(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_league leagues%rowtype; v_draft drafts%rowtype;
  v_uid uuid := auth.uid(); v_is_commish boolean;
  v_teams integer; v_invited integer; v_joined integer; v_slots_set integer; v_slots_ok boolean;
  v_picks_made integer; v_picks_total integer;
  v_players integer; v_with_adp integer; v_with_bye integer; v_games integer;
  v_next_kick timestamptz; v_week integer; v_matchups integer; v_rules integer;
  v_last_stats timestamptz; v_last_ingest timestamptz; v_queue_teams integer;
  v_open_chal integer; v_msgs integer;
  v_managers jsonb; v_activity jsonb; v_checks jsonb; v_calendar jsonb; v_jobs jsonb;
  v_jobs_ok boolean := false; v_jobs_bad integer := 0; v_jobs_total integer := 0;
  v_ready integer := 0; v_total_checks integer := 0;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if v_uid is not null
     and not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_is_commish := (v_uid is not null and v_league.commissioner_id = v_uid);

  select * into v_draft from drafts where league_id = p_league_id order by started_at nulls last, id limit 1;

  select count(*),
         count(*) filter (where owner_email is not null and owner_email <> ''),
         count(*) filter (where owner_id is not null),
         count(*) filter (where draft_slot is not null)
    into v_teams, v_invited, v_joined, v_slots_set
    from teams where league_id = p_league_id;

  select count(distinct draft_slot) = v_teams into v_slots_ok
    from teams where league_id = p_league_id and draft_slot is not null;
  v_slots_ok := coalesce(v_slots_ok, false) and v_slots_set = v_teams;

  v_picks_total := coalesce(v_teams,0) * coalesce(v_draft.rounds,0);
  select count(*) into v_picks_made from draft_picks where draft_id = v_draft.id;

  select count(*), count(*) filter (where bye_week is not null)
    into v_players, v_with_bye
    from players where position in ('QB','RB','WR','TE','K','DST');

  select count(*) into v_with_adp from player_adp where season = v_league.season;

  select count(*), min(kickoff_at) filter (where kickoff_at > now())
    into v_games, v_next_kick
    from nfl_games where season = v_league.season and season_type = 2;

  v_week := public.ff_current_week();

  select count(*) into v_matchups from matchups where league_id = p_league_id;
  select count(*) into v_rules   from league_scoring_rules where league_id = p_league_id;
  select max(updated_at) into v_last_stats from player_stat_lines;
  select max(created_at) into v_last_ingest from ingest_log;

  select count(distinct team_id) into v_queue_teams
    from draft_queue q join teams t on t.id = q.team_id where t.league_id = p_league_id;

  select count(*) into v_open_chal from challenges
   where league_id = p_league_id
     and status in ('proposed','accepted','locked','awaiting_result','disputed');

  select count(*) into v_msgs from league_messages
   where league_id = p_league_id and created_at > now() - interval '7 days';

  -- ---------------------------------------------------------- automation --
  -- Late-or-failing is judged against each job's own cadence, so a nightly
  -- settle job is not reported as broken between runs. Wrapped in a block so
  -- the whole dashboard still renders if cron.* is ever unreadable.
  begin
    select coalesce(jsonb_agg(j order by j->>'name'), '[]'::jsonb),
           count(*), count(*) filter (where (j->>'healthy')::boolean is not true)
      into v_jobs, v_jobs_total, v_jobs_bad
    from (
      select jsonb_build_object(
        'name', c.jobname,
        'schedule', c.schedule,
        'active', c.active,
        'last_run', r.start_time,
        'last_status', r.status,
        'healthy', c.active and r.status = 'succeeded'
                   and r.start_time > now() - (case
                       when c.schedule like '%second%' then interval '2 minutes'
                       when c.schedule like '*/2%'     then interval '10 minutes'
                       when c.schedule like '*/5%'     then interval '20 minutes'
                       else interval '36 hours' end)
      ) as j
      from cron.job c
      left join lateral (
        select d.status, d.start_time
          from cron.job_run_details d
         where d.jobid = c.jobid
         order by d.start_time desc limit 1
      ) r on true
    ) s;
    v_jobs_ok := coalesce(v_jobs_bad, 0) = 0 and coalesce(v_jobs_total,0) > 0;
  exception when others then
    v_jobs := '[]'::jsonb; v_jobs_ok := false; v_jobs_bad := 0; v_jobs_total := 0;
  end;

  -- ------------------------------------------------------------ managers --
  select coalesce(jsonb_agg(m order by m->>'slot_sort'), '[]'::jsonb) into v_managers
  from (
    select jsonb_build_object(
      'team_id', t.id, 'name', t.name, 'draft_slot', t.draft_slot,
      'slot_sort', lpad(coalesce(t.draft_slot, 99)::text, 2, '0') || t.name,
      'email', t.owner_email,
      'joined', (t.owner_id is not null),
      'invited', (t.owner_email is not null and t.owner_email <> ''),
      'display_name', p.display_name,
      'queued', (select count(*) from draft_queue q where q.team_id = t.id),
      'roster', (select count(*) from rosters r where r.team_id = t.id and r.week = greatest(v_week,1)),
      'picks',  (select count(*) from draft_picks dp where dp.team_id = t.id)
    ) as m
    from teams t left join profiles p on p.id = t.owner_id
    where t.league_id = p_league_id
  ) s;

  select coalesce(jsonb_agg(a order by (a->>'created_at') desc), '[]'::jsonb) into v_activity
  from (
    select jsonb_build_object('id', e.id, 'type', e.event_type, 'headline', e.headline,
      'detail', e.detail, 'created_at', e.created_at, 'actor', p.display_name) as a
    from activity_events e left join profiles p on p.id = e.actor_id
    where e.league_id = p_league_id order by e.created_at desc limit 12
  ) s;

  select coalesce(jsonb_agg(c order by (c->>'week')::int), '[]'::jsonb) into v_calendar
  from (
    select jsonb_build_object('week', g.week, 'games', count(*),
      'first_kick', min(g.kickoff_at), 'last_kick', max(g.kickoff_at),
      'final', count(*) filter (where g.status = 'post')) as c
    from nfl_games g
    where g.season = v_league.season and g.season_type = 2
    group by g.week order by g.week limit 20
  ) s;

  -- ------------------------------------------------------------ checklist -
  v_checks := jsonb_build_array(
    jsonb_build_object('key','commish','label','Commissioner claimed',
      'ok', v_league.commissioner_id is not null,
      'detail', case when v_league.commissioner_id is not null then 'Locked to one account.'
                     else 'Nobody owns the controls yet - claim it before invites go out.' end, 'fix','/admin'),
    jsonb_build_object('key','invited','label','All managers invited',
      'ok', v_invited >= v_teams and v_teams > 0,
      'detail', v_invited || ' of ' || v_teams || ' seats have an email on file.', 'fix','/admin'),
    jsonb_build_object('key','joined','label','All managers signed in',
      'ok', v_joined >= v_teams and v_teams > 0,
      'detail', v_joined || ' of ' || v_teams || ' have created a login.', 'fix','/admin'),
    jsonb_build_object('key','order','label','Draft order set',
      'ok', v_slots_ok,
      'detail', case when v_slots_ok then 'Slots 1-' || v_teams || ' assigned, no duplicates.'
                     else v_slots_set || ' of ' || v_teams || ' slots assigned. Randomize to finish.' end, 'fix','/admin'),
    jsonb_build_object('key','pool','label','Player pool loaded',
      'ok', v_players > 500, 'detail', v_players || ' skill players in the pool.', 'fix','/players'),
    jsonb_build_object('key','adp','label','ADP loaded',
      'ok', v_with_adp > 100, 'detail', v_with_adp || ' players ranked for ' || v_league.season || '.', 'fix','/admin'),
    jsonb_build_object('key','byes','label','Bye weeks populated',
      'ok', v_with_bye > 500, 'detail', v_with_bye || ' of ' || v_players || ' players have a bye on file.', 'fix','/admin'),
    jsonb_build_object('key','schedule','label','NFL schedule loaded',
      'ok', v_games > 200, 'detail', v_games || ' regular-season games for ' || v_league.season || '.', 'fix','/admin'),
    jsonb_build_object('key','scoring','label','Scoring rules published',
      'ok', v_rules > 0 or coalesce(jsonb_typeof(v_league.scoring_rules),'null') = 'object',
      'detail', case when v_rules > 0 then v_rules || ' rule set(s) on record.' else 'Running league defaults.' end, 'fix','/admin'),
    jsonb_build_object('key','matchups','label','Season schedule generated',
      'ok', v_matchups > 0,
      'detail', case when v_matchups > 0 then v_matchups || ' matchups scheduled.'
                     else 'Generates automatically when the draft completes.' end, 'fix','/matchups'),
    jsonb_build_object('key','automation','label','Background jobs healthy',
      'ok', v_jobs_ok,
      'detail', case when coalesce(v_jobs_total,0) = 0 then 'Job status unavailable.'
                     when v_jobs_ok then v_jobs_total || ' scheduled jobs running on time.'
                     else v_jobs_bad || ' of ' || v_jobs_total || ' jobs are late or failing.' end, 'fix','/admin'),
    jsonb_build_object('key','queues','label','Managers have a draft queue',
      'ok', v_queue_teams >= v_teams and v_teams > 0,
      'detail', v_queue_teams || ' of ' || v_teams || ' teams have queued a player. Autopick follows the queue.', 'fix','/draft')
  );

  select count(*) filter (where (c->>'ok')::boolean), count(*)
    into v_ready, v_total_checks from jsonb_array_elements(v_checks) c;

  return jsonb_build_object(
    'league', jsonb_build_object('id', v_league.id, 'name', v_league.name, 'season', v_league.season,
      'team_count', v_teams, 'roster_slots', v_league.roster_slots,
      'commissioner_id', v_league.commissioner_id, 'is_commissioner', v_is_commish),
    'draft', case when v_draft.id is null then null else jsonb_build_object(
      'id', v_draft.id, 'status', v_draft.status, 'rounds', v_draft.rounds,
      'pick_seconds', v_draft.pick_seconds, 'current_pick', v_draft.current_pick,
      'pick_deadline', v_draft.pick_deadline, 'started_at', v_draft.started_at,
      'completed_at', v_draft.completed_at, 'picks_made', v_picks_made,
      'picks_total', v_picks_total, 'order_set', v_slots_ok, 'teams_with_queue', v_queue_teams) end,
    'managers', v_managers,
    'checks', v_checks,
    'readiness', jsonb_build_object('passed', v_ready, 'total', v_total_checks,
      'pct', case when v_total_checks = 0 then 0 else round(v_ready::numeric * 100 / v_total_checks) end),
    'data', jsonb_build_object('players', v_players, 'adp', v_with_adp, 'byes', v_with_bye,
      'games', v_games, 'last_stats_at', v_last_stats, 'last_ingest_at', v_last_ingest,
      'jobs', v_jobs),
    'season', jsonb_build_object('week', v_week, 'next_kickoff', v_next_kick, 'calendar', v_calendar),
    'clubhouse', jsonb_build_object('open_challenges', v_open_chal, 'messages_7d', v_msgs),
    'activity', v_activity,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.ff_league_pulse(uuid) from public;
grant execute on function public.ff_league_pulse(uuid) to authenticated;

comment on function public.ff_league_pulse(uuid) is
  'Commissioner dashboard payload: readiness checklist, manager join status, data freshness, cron health, season calendar and activity in one round trip.';
