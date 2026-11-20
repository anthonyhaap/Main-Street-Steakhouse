-- ============================================================================
-- A dropped player clears waivers two days after the drop, not next Wednesday.
--
-- Until now a release stayed on the wire until the next weekly settlement. A
-- player dropped minutes after Wednesday's run waited seven days; one dropped
-- on Tuesday night waited a few hours. A whole week's drops were out of reach
-- for that Sunday, which is not how anybody's other league works: ESPN, Yahoo
-- and Sleeper all hold a released player for a fixed time from the drop
-- (two days by default) and then let him go.
--
-- So that is the rule here now:
--
--   * clears_at = the moment of the drop + `waiver_days` (league setting,
--     default 2). Every reader of "when does he clear" already goes through
--     ff_on_waivers, so the change is made once, in ff_waiver_clears_at.
--
--   * The settlement runs whenever somebody's time is up, not once a week.
--     ff_process_waivers is asked every five minutes and settles the league
--     if any player on the wire has reached his clearing time. ff_run_waivers
--     already only settles players whose clears_at has passed and leaves the
--     rest pending, so a claim on a man who clears on Saturday is not decided
--     by Friday's run. Rolling priority works exactly as before.
--
--   * A player is still on the wire until a run at or after his clearing time
--     has been recorded, so nobody can sign him outright in the minutes between
--     his time arriving and the claims on him being answered.
--
-- Never-owned players are untouched: they were never on waivers and still
-- sign on the spot.
--
-- `waiver_run_day` stays in the settings. ff_next_waiver_run is no longer
-- used to stamp a clearing time, and is left as it is for anything that reads
-- it.
-- ============================================================================

-- When a player dropped at a given moment comes off the wire.
--
-- `waiver_days` is read as a whole number of days, 0 to 14. Anything else in
-- the setting (absent, blank, nonsense) is the default of two, rather than a
-- cast error inside every screen that lists a waiver.
create or replace function public.ff_waiver_clears_at(p_league_id uuid, p_dropped_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select p_dropped_at + make_interval(days => coalesce((
    select least(14, (l.settings->>'waiver_days')::int)
      from leagues l
     where l.id = p_league_id
       and l.settings->>'waiver_days' ~ '^\s*\d{1,2}\s*$'
  ), 2))
$$;

comment on function public.ff_waiver_clears_at(uuid, timestamptz) is
  'When a player dropped at p_dropped_at clears waivers: the drop plus the league''s waiver_days (default 2).';

-- Who is on waivers, and until when. Unchanged from 20260905125401 apart from
-- the clearing time, which is now counted from the drop.
create or replace function public.ff_on_waivers(p_league_id uuid)
returns table (player_id uuid, dropped_at timestamptz, clears_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with last_move as (
    select distinct on (i.player_id)
           i.player_id, i.to_team_id, t.created_at
      from transaction_items i
      join transactions t on t.id = i.transaction_id
     where t.league_id = p_league_id
     order by i.player_id, t.week desc, t.ord desc, i.seq desc
  ),
  dropped as (
    select m.player_id, m.created_at as dropped_at,
           ff_waiver_clears_at(p_league_id, m.created_at) as clears_at
      from last_move m
     where m.to_team_id is null
  )
  select d.player_id, d.dropped_at, d.clears_at
    from dropped d
   -- On the wire until a settlement has run at or after his clearing time, so
   -- the claims on him are answered before anybody can sign him outright.
   where not exists (
     select 1 from waiver_runs r
      where r.league_id = p_league_id and r.ran_at >= d.clears_at)
   -- ...and while anybody still has a claim in on him. The clearing time is
   -- recomputed from the league's setting on every read, so a commissioner who
   -- shortens `waiver_days` can move it to before a run that happened for
   -- somebody else — a run that never decided this player's claims. Without
   -- this he would leave the wire with those claims pending forever and be
   -- signable outright. With it he stays, is due (his clears_at has passed),
   -- and the next tick settles him.
      or exists (
     select 1 from waiver_claims c
      where c.league_id = p_league_id and c.add_player_id = d.player_id
        and c.status = 'pending')
$$;

comment on function public.ff_on_waivers(uuid) is
  'Players whose last transaction was a drop and whose clearing time (drop + waiver_days) has not yet been served by a run, or who still have a pending claim on them. Never-owned players are free agents, not waivers.';

-- Settle every claim whose player has cleared.
--
-- Unchanged from 20260905125401 except that `claims_seen` counts only the
-- claims this settlement actually decides. With runs every time a player
-- clears rather than once a week, counting every pending claim in the league
-- would announce "0 of 3 claims awarded" about claims on players who do not
-- clear until the weekend.
create or replace function public.ff_run_waivers(p_league_id uuid, p_week integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week   integer := coalesce(p_week, ff_current_week());
  v_status text;
  v_limit  integer;
  v_claim  record;
  v_size   integer;
  v_owner  uuid;
  v_txn    uuid;
  v_seen   integer := 0;
  v_won    integer := 0;
  v_run    uuid;
  v_awards jsonb := '[]'::jsonb;
begin
  -- The same key ff_add_drop takes, so a manager cannot sign a player out from
  -- under a settlement that is halfway through awarding him.
  perform pg_advisory_xact_lock(hashtext('ff_add_drop:' || p_league_id::text));

  select d.status::text into v_status from drafts d
   where d.league_id = p_league_id order by d.started_at nulls last, d.id limit 1;
  if v_status is distinct from 'complete' then
    return jsonb_build_object('ran', false, 'why', 'the draft is not finished');
  end if;

  -- An unordered league is placed before anything is awarded; see
  -- 20260905125401 for why the run cannot proceed on NULL priorities.
  perform ff_place_unordered_teams(p_league_id);

  select jsonb_array_length(roster_slots) into v_limit from leagues where id = p_league_id;

  -- Dropped explicitly as well as on commit: ff_process_waivers calls this once
  -- per league inside one transaction.
  if to_regclass('pg_temp._claimable') is not null then
    execute 'drop table _claimable';
  end if;
  -- Only the men whose clearing time has arrived.
  create temp table _claimable on commit drop as
    select w.player_id from ff_on_waivers(p_league_id) w where w.clears_at <= now();

  -- The same set, kept whole, for the closing "everyone else lost".
  if to_regclass('pg_temp._due') is not null then execute 'drop table _due'; end if;
  create temp table _due on commit drop as select player_id from _claimable;

  -- The claims this settlement decides, and no others.
  select count(*) into v_seen from waiver_claims
   where league_id = p_league_id and status = 'pending'
     and add_player_id in (select player_id from _due);

  loop
    -- Best remaining claim, by the league's order first and the manager's second.
    select c.*, t.waiver_priority into v_claim
      from waiver_claims c
      join teams t on t.id = c.team_id
     where c.league_id = p_league_id and c.status = 'pending'
       and exists (select 1 from _claimable k where k.player_id = c.add_player_id)
     order by t.waiver_priority nulls last, c.claim_order, c.created_at
     limit 1;

    exit when v_claim.id is null;

    -- Re-checked at award time, not at claim time: a roster changes between
    -- filing and settling, and a claim that was legal when filed may not be.
    if v_claim.drop_player_id is not null then
      select o.team_id into v_owner from ff_owner_at(p_league_id, v_week) o
       where o.player_id = v_claim.drop_player_id;
      if v_owner is distinct from v_claim.team_id then
        update waiver_claims set status = 'invalid', processed_at = now(),
               priority_at_run = v_claim.waiver_priority,
               outcome = 'the player named to make way was already gone'
         where id = v_claim.id;
        continue;
      end if;
    end if;

    -- Kickoff, re-checked here and not only when the claim was filed.
    if (select ff_lock_time(v_claim.add_player_id, v_week)) <= now() then
      update waiver_claims set status = 'invalid', processed_at = now(),
             priority_at_run = v_claim.waiver_priority,
             outcome = 'his game had kicked off by the time waivers ran'
       where id = v_claim.id;
      delete from _claimable where player_id = v_claim.add_player_id;
      continue;
    end if;
    if v_claim.drop_player_id is not null
       and (select ff_lock_time(v_claim.drop_player_id, v_week)) <= now() then
      update waiver_claims set status = 'invalid', processed_at = now(),
             priority_at_run = v_claim.waiver_priority,
             outcome = 'the player named to make way had already kicked off'
       where id = v_claim.id;
      continue;
    end if;

    select count(*) into v_size from ff_owner_at(p_league_id, v_week) o
     where o.team_id = v_claim.team_id;
    v_size := v_size + 1 - (case when v_claim.drop_player_id is not null then 1 else 0 end);
    if v_limit is not null and v_size > v_limit then
      update waiver_claims set status = 'invalid', processed_at = now(),
             priority_at_run = v_claim.waiver_priority,
             outcome = 'no room: the roster was full and no player was named to make way'
       where id = v_claim.id;
      continue;
    end if;

    -- Won. The same two items an add/drop writes, under kind 'waiver'.
    insert into transactions (league_id, kind, week, actor_id, note)
    values (p_league_id, 'waiver', v_week, v_claim.actor_id,
            'waiver claim, priority ' || coalesce(v_claim.waiver_priority::text, '?'))
    returning id into v_txn;

    if v_claim.drop_player_id is not null then
      insert into transaction_items (transaction_id, player_id, from_team_id, to_team_id, seq)
      values (v_txn, v_claim.drop_player_id, v_claim.team_id, null, 0);
    end if;
    insert into transaction_items (transaction_id, player_id, from_team_id, to_team_id, seq)
    values (v_txn, v_claim.add_player_id, null, v_claim.team_id, 1);

    update waiver_claims set status = 'won', processed_at = now(),
           priority_at_run = v_claim.waiver_priority, transaction_id = v_txn,
           outcome = 'awarded'
     where id = v_claim.id;

    delete from _claimable where player_id = v_claim.add_player_id;
    perform ff_materialize_roster(v_claim.team_id, v_week);

    -- To the back, then renumber so the order stays 1..n with no gaps.
    update teams set waiver_priority =
      (select coalesce(max(waiver_priority), 0) + 1 from teams where league_id = p_league_id)
     where id = v_claim.team_id;
    update teams t set waiver_priority = s.rank
      from (select id, row_number() over (order by waiver_priority nulls last, name) as rank
              from teams where league_id = p_league_id) s
     where t.id = s.id and t.league_id = p_league_id;

    v_won := v_won + 1;
    v_awards := v_awards || jsonb_build_object(
      'team', (select name from teams where id = v_claim.team_id),
      'player', (select full_name from players where id = v_claim.add_player_id));
    v_claim := null;
  end loop;

  -- Everyone else who was in this settlement lost to somebody — only for
  -- players who were actually due.
  update waiver_claims set status = 'lost', processed_at = now(),
         outcome = 'another team had the higher claim'
   where league_id = p_league_id and status = 'pending'
     and add_player_id in (select player_id from _due);

  drop table _claimable;
  drop table _due;

  insert into waiver_runs (league_id, week, claims_seen, claims_awarded)
  values (p_league_id, v_week, v_seen, v_won) returning id into v_run;

  if v_seen > 0 then
    insert into activity_events (league_id, event_type, headline, detail, source_type, source_id)
    values (p_league_id, 'waiver',
            left('Waivers cleared: ' || v_won || ' of ' || v_seen || ' claim'
                 || case when v_seen = 1 then '' else 's' end || ' awarded', 140),
            'Week ' || v_week, 'waiver_run', v_run);
  end if;

  return jsonb_build_object('ran', true, 'run_id', v_run, 'week', v_week,
                            'claims_seen', v_seen, 'claims_awarded', v_won,
                            'awards', v_awards);
end $$;

-- Settle any league with a player whose clearing time has arrived.
--
-- Asked every five minutes. It does nothing unless somebody on the wire is
-- due, and a second call straight after a settlement finds nobody due —
-- the run it just recorded serves every clearing time up to now.
create or replace function public.ff_process_waivers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid; v_n integer := 0;
begin
  for v_league in select id from leagues loop
    if exists (select 1 from ff_on_waivers(v_league) w where w.clears_at <= now()) then
      perform ff_run_waivers(v_league);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Same job name, so this replaces the daily 08:05 schedule rather than adding
-- a second job.
select cron.schedule('waivers', '*/5 * * * *', 'select public.ff_process_waivers()');

-- When the wire next settles, for the desk and the board: the earliest
-- clearing time of anybody still on it. Null when nobody is on waivers, which
-- is most of the time — there is nothing to wait for.
--
-- A clearing time that has passed but not yet been served settles at the next
-- five-minute tick, so the screen never names a moment in the past.
create or replace function public.ff_waiver_settles_at(p_league_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when min(w.clears_at) is null then null
    when min(w.clears_at) > now() then min(w.clears_at)
    else date_trunc('hour', now())
         + make_interval(mins => (floor(extract(minute from now()) / 5)::int + 1) * 5)
  end
  from ff_on_waivers(p_league_id) w
$$;

comment on function public.ff_waiver_settles_at(uuid) is
  'When the wire next settles: the earliest clearing time of a player on waivers, or the next five-minute tick if that time has passed. Null when nobody is on waivers.';

-- The board. Unchanged from 20260915133033 apart from two things. `recent`
-- lists only runs that decided a claim: with a run every time somebody clears,
-- the empty ones would push the real results off the list. And it carries
-- `waiver_days`, so the screen states the league's rule rather than a number
-- of its own.
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

  -- The owner, and nobody else — not even the commissioner. See
  -- 20260905125401: this is SECURITY DEFINER, so RLS does not keep pending
  -- claims private in here; this check does.
  if v_uid is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;

  return jsonb_build_object(
    'settles_at', ff_waiver_settles_at(v_league),
    'waiver_days', extract(day from ff_waiver_clears_at(v_league, now()) - now())::int,
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
             ) order by w.clears_at, p.full_name), '[]'::jsonb)
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
        from (select * from waiver_runs where league_id = v_league and claims_seen > 0
               order by ran_at desc limit 5) r)
  );
end $$;

-- The league's own setting, written down so the rules screen and anyone
-- reading `settings` see it rather than an invisible default.
update leagues set settings = settings || '{"waiver_days": 2}'::jsonb
 where not (settings ? 'waiver_days');

-- ------------------------------------------------------------- the grants --
-- A function is granted to authenticated the moment it is created on this
-- project (see supabase/tests/grants.sql). The clearing-time helper is an
-- internal: the SECURITY DEFINER functions above call it as the definer.
revoke execute on function public.ff_waiver_clears_at(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.ff_waiver_clears_at(uuid, timestamptz) to service_role;

revoke execute on function public.ff_on_waivers(uuid)          from public, anon;
revoke execute on function public.ff_run_waivers(uuid,integer) from public, anon, authenticated;
revoke execute on function public.ff_process_waivers()         from public, anon, authenticated;
revoke execute on function public.ff_waiver_settles_at(uuid)   from public, anon;
revoke execute on function public.ff_waiver_board(uuid)        from public, anon;
grant  execute on function public.ff_on_waivers(uuid)          to authenticated, service_role;
grant  execute on function public.ff_run_waivers(uuid,integer) to service_role;
grant  execute on function public.ff_process_waivers()         to service_role;
grant  execute on function public.ff_waiver_settles_at(uuid)   to authenticated, service_role;
grant  execute on function public.ff_waiver_board(uuid)        to authenticated, service_role;
