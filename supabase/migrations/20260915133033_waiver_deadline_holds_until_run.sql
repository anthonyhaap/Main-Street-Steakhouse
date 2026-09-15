-- ============================================================================
-- The advertised settlement holds until the run that serves it has happened.
--
-- `ff_waiver_board` told the wire when it settles with
-- `ff_next_waiver_run(league, now())`, which is the first scheduled instant
-- STRICTLY after the clock. The cron that actually settles the wire fires at
-- 08:05, five minutes after the 08:00 instant it serves. So between 08:00 and
-- 08:05 every settlement Wednesday the board — and, since #49, the manager's
-- own desk — said "next Wednesday" about a run that was minutes from settling
-- the claims on the screen. A manager who filed a claim at 08:02 was told he
-- had a week to reorder it and had three minutes.
--
-- The same gap opens for longer whenever a due settlement has gone unserved:
-- a cron that failed on Wednesday and catches up on Thursday, or a draft that
-- finished on a Thursday night with last Wednesday's instant still standing.
-- In both cases the next tick of the cron settles the wire, and the board
-- said next week.
--
-- So the settlement a manager is shown is derived from what is outstanding
-- rather than from the clock alone. If the most recent scheduled instant has
-- passed and no run has been recorded since it — the condition
-- `ff_process_waivers` itself uses to decide to run — the wire settles at the
-- next tick of the cron that will serve it. Otherwise it settles at the next
-- scheduled instant, as before.
--
-- `ff_next_waiver_run` is NOT changed. `ff_on_waivers` uses it to stamp a
-- dropped player's clearing time from the moment of the drop, and a player
-- released at 08:02 must clear NEXT Wednesday, not be swept up at 08:05 — the
-- rule that function's own comments are about. This is a second question with
-- a second function.
-- ============================================================================

-- When the wire next settles, for the people reading it.
--
-- The draft has to be complete for a due instant to count as outstanding:
-- `ff_run_waivers` refuses to settle an undrafted league and records no run,
-- so all preseason the most recent Wednesday would otherwise stand forever
-- unserved and the board would name a day in the past.
--
-- The tick is read from the cron job rather than written here, so the two
-- cannot drift: if the schedule moves, this moves with it. Only the daily
-- "M H * * *" shape is understood, which is the shape it has; anything else
-- falls back to the due instant itself, which is at least not next week.
create or replace function public.ff_waiver_settles_at(p_league_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_next  timestamptz := ff_next_waiver_run(p_league_id, now());
  v_due   timestamptz;
  v_sched text;
  v_tick  timestamptz;
begin
  v_due := v_next - interval '7 days';

  -- Served, or nothing yet to serve: the schedule is the answer.
  if exists (select 1 from waiver_runs w
              where w.league_id = p_league_id and w.ran_at >= v_due)
     or not exists (select 1 from drafts d
                     where d.league_id = p_league_id and d.status::text = 'complete') then
    return v_next;
  end if;

  -- Due and unserved: it settles at the next tick of the cron that serves it.
  select c.schedule into v_sched from cron.job c
   where c.jobname = 'waivers' and c.active
   limit 1;

  if v_sched ~ '^\d{1,2} \d{1,2} \* \* \*$' then
    v_tick := (date_trunc('day', now() at time zone 'UTC')
               + make_interval(hours => split_part(v_sched, ' ', 2)::int,
                               mins  => split_part(v_sched, ' ', 1)::int))
              at time zone 'UTC';
    if v_tick <= now() then
      v_tick := v_tick + interval '1 day';
    end if;
    return v_tick;
  end if;

  return v_due;
end $$;

comment on function public.ff_waiver_settles_at(uuid) is
  'When the wire next settles, as the board and the desk should say it: the next cron tick if a scheduled run is due and unserved, else the next scheduled instant.';

revoke execute on function public.ff_waiver_settles_at(uuid) from public, anon;
grant  execute on function public.ff_waiver_settles_at(uuid) to authenticated, service_role;

-- The board, saying the same thing. Body unchanged apart from `settles_at`.
create or replace function public.ff_waiver_board(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid; v_uid uuid := auth.uid();
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;

  -- The owner, and nobody else. This is SECURITY DEFINER, so the RLS policy
  -- that keeps a pending claim private does not apply inside it — membership
  -- alone was enough to read the blind claims of the manager you are bidding
  -- against by passing his team id.
  --
  -- Not even the commissioner, deliberately. He has a team in this league and
  -- files claims against the same players, so an exemption for him is an
  -- exemption for one of the competitors — and "blind until Wednesday" would
  -- be true of eleven managers and false of the twelfth. It is the same line
  -- ff_add_drop draws: the service role is where commissioner intervention
  -- belongs, with a different audit trail.
  if v_uid is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;

  return jsonb_build_object(
    'settles_at', ff_waiver_settles_at(v_league),
    'my_priority', (select waiver_priority from teams where id = p_team_id),
    'order', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team', name, 'priority', waiver_priority) order by waiver_priority), '[]'::jsonb)
        from teams where league_id = v_league),
    'on_waivers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', w.player_id, 'player', p.full_name,
               'position', p.position, 'nfl_team', p.nfl_team,
               'dropped_at', w.dropped_at, 'clears_at', w.clears_at
             ) order by p.full_name), '[]'::jsonb)
        from ff_on_waivers(v_league) w join players p on p.id = w.player_id),
    'my_claims', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'claim_id', c.id, 'order', c.claim_order,
               'add', ap.full_name, 'add_player_id', c.add_player_id,
               'drop', dp.full_name, 'drop_player_id', c.drop_player_id,
               'status', c.status, 'outcome', c.outcome
             ) order by c.claim_order), '[]'::jsonb)
        from waiver_claims c
        join players ap on ap.id = c.add_player_id
        left join players dp on dp.id = c.drop_player_id
       where c.team_id = p_team_id and c.status = 'pending'),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'ran_at', r.ran_at, 'week', r.week,
               'seen', r.claims_seen, 'awarded', r.claims_awarded
             ) order by r.ran_at desc), '[]'::jsonb)
        from (select * from waiver_runs where league_id = v_league
               order by ran_at desc limit 5) r)
  );
end $$;
