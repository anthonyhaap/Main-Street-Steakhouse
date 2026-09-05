-- ============================================================================
-- Waivers: claims, rolling priority, and a run that settles them at once.
--
-- The league already said how it wants this to work. `leagues.settings` has
-- carried `waiver_type: rolling_priority` and `waiver_run_day: wednesday` since
-- the league was configured, so none of that is invented here — it is read.
-- FAAB is a second `waiver_type` and not this migration's business; every
-- decision below is behind that setting rather than baked in.
--
-- The shape is the one add/drop already built. A claim, once it wins, is an
-- ordinary transaction with `kind = 'waiver'` and the same two items an
-- add/drop writes, so `ff_owner_at` needs no changes at all and the ledger,
-- the roster cache and the feed all keep working. What is new is everything
-- BEFORE that: who may ask, in what order they are answered, and what happens
-- to the ones who lose.
-- ============================================================================

-- --------------------------------------------------------------- the runs --

-- Every settlement, recorded. Two things need this: a player is on waivers
-- only until the next run, so "when did the last one happen" is what makes
-- that derivable; and a run must be idempotent, because a cron that fires
-- twice must not process the same claims twice.
create table if not exists public.waiver_runs (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  week       integer not null,
  ran_at     timestamptz not null default now(),
  claims_seen    integer not null default 0,
  claims_awarded integer not null default 0
);
create index if not exists waiver_runs_league_idx
  on public.waiver_runs (league_id, ran_at desc);

comment on table public.waiver_runs is
  'One row per waiver settlement. The most recent one is what decides whether a dropped player is still on waivers.';

-- -------------------------------------------------------------- the claims --

create table if not exists public.waiver_claims (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references public.leagues(id) on delete cascade,
  team_id         uuid not null references public.teams(id) on delete cascade,
  add_player_id   uuid not null references public.players(id),
  -- Named up front, not chosen later: a claim that wins on a full roster has
  -- to know who makes way, and asking the manager afterwards means a roster
  -- over its cap in the meantime.
  drop_player_id  uuid references public.players(id),
  -- A manager's own ranking of their claims. The run awards at most one claim
  -- per team per pass, so this is how they say which one they want most.
  claim_order     integer not null default 1,
  week            integer not null check (week between 1 and 25),
  status          text not null default 'pending'
                  check (status in ('pending','won','lost','invalid','cancelled')),
  -- Why a claim did not win, in the manager's language. Filled by the run.
  outcome         text check (outcome is null or char_length(outcome) <= 200),
  priority_at_run integer,
  transaction_id  uuid references public.transactions(id) on delete set null,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz,
  actor_id        uuid references auth.users(id) on delete set null,
  constraint waiver_claims_not_a_loop
    check (drop_player_id is null or drop_player_id <> add_player_id)
);
-- One live claim per team per player. A manager who claims the same man twice
-- meant to change his mind, not to enter twice. A partial unique index rather
-- than an exclusion constraint, which would need btree_gist for `=`.
create unique index if not exists waiver_claims_one_live
  on public.waiver_claims (team_id, add_player_id) where (status = 'pending');
create index if not exists waiver_claims_league_idx
  on public.waiver_claims (league_id, status, claim_order);
create index if not exists waiver_claims_team_idx
  on public.waiver_claims (team_id, status);

comment on table public.waiver_claims is
  'A request to sign a player who is on waivers. Settled in priority order by ff_run_waivers; a winning claim becomes an ordinary transaction.';

alter table public.waiver_runs   enable row level security;
alter table public.waiver_claims enable row level security;

-- A claim is readable by the whole league AFTER it is settled, and before that
-- only by its owner. Blind is the point: a pending claim everyone can read is a
-- pending claim everyone can outbid — and that includes the commissioner, who
-- has a team of his own and is bidding against the people he would be reading.
drop policy if exists waiver_runs_read on public.waiver_runs;
create policy waiver_runs_read on public.waiver_runs
  for select to authenticated using (public.ff_is_member());

drop policy if exists waiver_claims_read on public.waiver_claims;
create policy waiver_claims_read on public.waiver_claims
  for select to authenticated using (
    public.ff_is_member() and (status <> 'pending' or public.ff_owns_team(team_id))
  );

revoke all on table public.waiver_runs   from public, anon;
revoke all on table public.waiver_claims from public, anon;
grant select on table public.waiver_runs   to authenticated;
grant select on table public.waiver_claims to authenticated;

-- ------------------------------------------------------------ the priority --

-- Rolling priority is a running order, not a history: win a claim and you go
-- to the back. It is stored rather than derived, because deriving it would
-- mean replaying every settlement since the draft to answer "who is first",
-- and unlike ownership there is no second reader that could disagree.
--
-- The opening order is the reverse of the draft: the manager who picked last
-- gets first call on the wire, which is the compensation for picking last.
alter table public.teams add column if not exists waiver_priority integer;

comment on column public.teams.waiver_priority is
  'Rolling waiver order, 1 = first call. Set from the reverse draft order and moved to the back each time the team wins a claim.';

-- Give an order to teams that have none, without disturbing one already in
-- use. A league mid-season has a real order earned by winning claims; only the
-- teams that have never had one are placed, and they go behind everybody.
create or replace function public.ff_place_unordered_teams(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  update teams t set waiver_priority = s.rank
    from (
      select id,
             (select coalesce(max(waiver_priority), 0) from teams where league_id = p_league_id)
             + row_number() over (order by draft_slot desc nulls last, name) as rank
        from teams where league_id = p_league_id and waiver_priority is null
    ) s
   where t.id = s.id and t.league_id = p_league_id;
  get diagnostics v_n = row_count;

  -- Contiguous 1..n afterwards, the same shape a settlement leaves behind.
  update teams t set waiver_priority = s.rank
    from (select id, row_number() over (order by waiver_priority nulls last, name) as rank
            from teams where league_id = p_league_id) s
   where t.id = s.id and t.league_id = p_league_id;

  return v_n;
end $$;

create or replace function public.ff_seed_waiver_priority(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform ff_assert_commissioner(p_league_id);

  update teams t set waiver_priority = s.rank
    from (
      select id,
             row_number() over (order by draft_slot desc nulls last, name) as rank
        from teams where league_id = p_league_id
    ) s
   where t.id = s.id and t.league_id = p_league_id;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- --------------------------------------------------------- when it settles --

-- The next settlement after a given moment, from the league's own settings.
-- `waiver_run_day` has said "wednesday" since the league was configured; the
-- hour is UTC and defaults to 08:00, which is the small hours in New York —
-- late enough that Monday and Tuesday night games are scored, early enough
-- that Wednesday morning is a fresh wire.
create or replace function public.ff_next_waiver_run(
  p_league_id uuid,
  p_after     timestamptz default now()
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select case lower(coalesce(l.settings->>'waiver_run_day', 'wednesday'))
             when 'sunday' then 0 when 'monday' then 1 when 'tuesday'  then 2
             when 'wednesday' then 3 when 'thursday' then 4 when 'friday' then 5
             when 'saturday' then 6 else 3 end                        as dow,
           coalesce((l.settings->>'waiver_run_hour_utc')::int, 8)     as hour
      from leagues l where l.id = p_league_id
  ),
  today as (
    select date_trunc('day', p_after) + make_interval(hours => cfg.hour) as at,
           cfg.dow,
           extract(dow from p_after)::int as now_dow
      from cfg
  )
  select case
    when at + make_interval(days => (dow - now_dow + 7) % 7) > p_after
      then at + make_interval(days => (dow - now_dow + 7) % 7)
    else   at + make_interval(days => ((dow - now_dow + 7) % 7) + 7)
  end
  from today
$$;

-- Who is on waivers, and until when.
--
-- A player is on waivers if the last thing that happened to him was a drop, and
-- that drop came after the league's most recent settlement. Nothing else needs
-- storing: "on waivers" is a fact about the transaction log and the run log,
-- exactly as ownership is a fact about the transaction log and the draft.
--
-- A player nobody has ever owned is NOT on waivers. He was never anybody's to
-- lose, so he is a free agent and ff_add_drop signs him on the spot — which is
-- what makes the wire worth watching on a Wednesday rather than a formality.
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
           ff_next_waiver_run(p_league_id, m.created_at) as clears_at
      from last_move m
     where m.to_team_id is null
  )
  select d.player_id, d.dropped_at, d.clears_at
    from dropped d
   -- He is on the wire until a settlement happens at or after the time this
   -- screen told everybody he would clear. Not "since the last run": a cron
   -- that fires at 08:05 for an 08:00 settlement would otherwise sweep up a
   -- player dropped at 08:02, three minutes after he was released and a week
   -- before the clearing time the board was advertising for him. And a player
   -- released BY a settlement has a clearing time next week, so that same run
   -- cannot consume him either — which is the case a timestamp comparison
   -- against `ran_at` got wrong in the other direction.
   where not exists (
     select 1 from waiver_runs r
      where r.league_id = p_league_id and r.ran_at >= d.clears_at)
$$;

comment on function public.ff_on_waivers(uuid) is
  'Players whose last transaction was a drop since the most recent waiver run. Never-owned players are free agents, not waivers.';

-- ------------------------------------------------------------- the asking --

-- File or amend a claim. Re-claiming a player you already have a live claim on
-- replaces it rather than entering twice — a manager doing that has changed his
-- mind about the drop or the order, not decided to queue up behind himself.
create or replace function public.ff_claim_waiver(
  p_team_id        uuid,
  p_add_player_id  uuid,
  p_drop_player_id uuid default null,
  p_claim_order    integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_league uuid;
  v_week   integer := ff_current_week();
  v_status text;
  v_order  integer;
  v_id     uuid;
  v_clears timestamptz;
  v_owner  uuid;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  if v_uid is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;

  -- The same lock the settlement takes. Filed a second either side of the
  -- boundary, a claim would otherwise be swept up by the run's closing "everyone
  -- else lost" without ever competing, or sit pending against a player the run
  -- has already awarded.
  perform pg_advisory_xact_lock(hashtext('ff_add_drop:' || v_league::text));

  select d.status::text into v_status from drafts d
   where d.league_id = v_league order by d.started_at nulls last, d.id limit 1;
  if v_status is distinct from 'complete' then
    raise exception 'the draft is not finished — no claims until it is';
  end if;

  -- Only a player actually on waivers. A free agent is signed on the spot
  -- through ff_add_drop, and a rostered player is not available at all.
  select w.clears_at into v_clears
    from ff_on_waivers(v_league) w where w.player_id = p_add_player_id;
  if v_clears is null then
    if exists (select 1 from ff_owner_at(v_league, v_week) o where o.player_id = p_add_player_id) then
      raise exception 'that player is on a roster';
    end if;
    raise exception 'that player is not on waivers — he is a free agent, sign him outright';
  end if;

  if p_drop_player_id is not null then
    select o.team_id into v_owner
      from ff_owner_at(v_league, v_week) o where o.player_id = p_drop_player_id;
    if v_owner is distinct from p_team_id then
      raise exception 'you cannot drop a player you do not own';
    end if;
  end if;

  v_order := coalesce(
    p_claim_order,
    (select coalesce(max(claim_order), 0) + 1 from waiver_claims
      where team_id = p_team_id and status = 'pending'));

  insert into waiver_claims (league_id, team_id, add_player_id, drop_player_id,
                             claim_order, week, actor_id)
  values (v_league, p_team_id, p_add_player_id, p_drop_player_id, v_order, v_week, v_uid)
  on conflict (team_id, add_player_id) where (status = 'pending')
  do update set drop_player_id = excluded.drop_player_id,
                claim_order    = excluded.claim_order,
                week           = excluded.week,
                created_at     = now()
  returning id into v_id;

  return jsonb_build_object(
    'claim_id', v_id, 'claim_order', v_order,
    'settles_at', v_clears, 'week', v_week);
end $$;

create or replace function public.ff_cancel_waiver_claim(p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_team uuid;
begin
  select team_id into v_team from waiver_claims where id = p_claim_id and status = 'pending';
  if v_team is null then return false; end if;
  if auth.uid() is not null and not ff_owns_team(v_team) then
    raise exception 'that is not your claim';
  end if;
  update waiver_claims set status = 'cancelled', processed_at = now() where id = p_claim_id;
  return true;
end $$;

-- A manager's own ranking, in one call: the array is the order.
create or replace function public.ff_order_waiver_claims(p_team_id uuid, p_claim_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if auth.uid() is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;
  update waiver_claims c set claim_order = x.ord
    from (select unnest(p_claim_ids) as id, generate_subscripts(p_claim_ids, 1) as ord) x
   where c.id = x.id and c.team_id = p_team_id and c.status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------------ the settling --

-- Settle every pending claim in the league at once.
--
-- Rolling priority, worked the way a room would: the manager with first call
-- gets the best claim he can still have, then goes to the back of the queue,
-- and the question is asked again. Not "one claim each" — a manager who wants
-- two players and keeps dropping to the back may well get both, after everyone
-- ahead of him has had their turn. That is what rolling means.
--
-- The claimable set is snapshotted BEFORE anything is awarded, because
-- ff_on_waivers reads the last run and this function is about to write one.
-- Progress is guaranteed: every pass either awards a claim (removing a player
-- from the set) or rejects one (removing a claim), so the loop cannot spin.
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

  -- An order of NULLs is not "no preference", it is a broken settlement: the
  -- run would fall back to claim order, and the winner would be handed
  -- priority 1 by `max(...) + 1` over an all-NULL column — first rather than
  -- last, which is rolling priority running backwards. Nothing calls the
  -- commissioner's seeder automatically, so the run refuses to proceed on an
  -- unordered league and places them itself.
  perform ff_place_unordered_teams(p_league_id);

  select jsonb_array_length(roster_slots) into v_limit from leagues where id = p_league_id;
  select count(*) into v_seen from waiver_claims
   where league_id = p_league_id and status = 'pending';


  -- `on commit drop` fires at COMMIT, not when this function returns, and
  -- ff_process_waivers calls this once per league inside one transaction — so
  -- without dropping it explicitly the second league in the loop dies on a
  -- table that is still there. Dropped at the end, and defensively here too.
  if to_regclass('pg_temp._claimable') is not null then
    execute 'drop table _claimable';
  end if;
  -- Only the men whose advertised clearing time has arrived. A wire the board
  -- says clears next Wednesday must not be settled today because the cron
  -- happened to run.
  create temp table _claimable on commit drop as
    select w.player_id from ff_on_waivers(p_league_id) w where w.clears_at <= now();

  -- The same set, kept whole. `_claimable` shrinks as players are awarded, and
  -- the closing "everyone else lost" below must only touch claims that were
  -- actually in this settlement — a claim on a man who does not clear until
  -- next Wednesday has not lost anything yet and stays pending.
  if to_regclass('pg_temp._due') is not null then execute 'drop table _due'; end if;
  create temp table _due on commit drop as select player_id from _claimable;

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
    -- Sunday and Wednesday, and a claim that was legal when filed may not be.
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

    -- Kickoff, re-checked here and not only when the claim was filed. A
    -- settlement delayed past a Thursday game would otherwise hand somebody a
    -- player whose points are already on the board, or release a starter who
    -- is mid-game — the same rule ff_add_drop applies, for the same reason.
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

    -- Won. The same two items an add/drop writes, under kind 'waiver', so
    -- ff_owner_at, the roster cache and the ledger need no special case.
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

  -- Everyone else who was in this settlement lost to somebody. Say so rather
  -- than leaving it pending — but only for players who were actually due.
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

-- ------------------------------------------------------------- the trigger --

-- Daily rather than weekly, and it decides for itself whether a settlement is
-- due — the same reasoning as ff_post_weekly_recaps. A cron that only fires on
-- Wednesdays loses the week if the Wednesday run fails; this one notices on
-- Thursday that the most recent scheduled moment has passed unserved, and
-- settles then. Running twice on one Wednesday is a no-op, because the second
-- pass finds a run already recorded after that moment.
create or replace function public.ff_process_waivers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid; v_due timestamptz; v_n integer := 0;
begin
  for v_league in select id from leagues loop
    v_due := ff_next_waiver_run(v_league, now()) - interval '7 days';
    if v_due <= now()
       and not exists (select 1 from waiver_runs w
                        where w.league_id = v_league and w.ran_at >= v_due) then
      perform ff_run_waivers(v_league);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

select cron.schedule('waivers', '5 8 * * *', 'select public.ff_process_waivers()');

-- --------------------------------------------------------------- the board --

-- One call for the wire screen: who is on waivers, when they clear, and this
-- team's own claims in their own order. Pending claims are visible only to
-- their owner, which the RLS policy enforces for direct reads and this
-- function honours by taking the team as an argument.
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
    'settles_at', ff_next_waiver_run(v_league, now()),
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

-- ------------------------------------------------------------- the grants --
revoke execute on function public.ff_place_unordered_teams(uuid)          from public, anon;
revoke execute on function public.ff_seed_waiver_priority(uuid)            from public, anon;
revoke execute on function public.ff_next_waiver_run(uuid, timestamptz)    from public, anon;
revoke execute on function public.ff_on_waivers(uuid)                      from public, anon;
revoke execute on function public.ff_claim_waiver(uuid,uuid,uuid,integer)  from public, anon;
revoke execute on function public.ff_cancel_waiver_claim(uuid)             from public, anon;
revoke execute on function public.ff_order_waiver_claims(uuid,uuid[])      from public, anon;
revoke execute on function public.ff_run_waivers(uuid,integer)             from public, anon;
revoke execute on function public.ff_process_waivers()                     from public, anon;
revoke execute on function public.ff_waiver_board(uuid)                    from public, anon;

grant execute on function public.ff_next_waiver_run(uuid, timestamptz)   to authenticated, service_role;
grant execute on function public.ff_on_waivers(uuid)                     to authenticated, service_role;
grant execute on function public.ff_claim_waiver(uuid,uuid,uuid,integer) to authenticated, service_role;
grant execute on function public.ff_cancel_waiver_claim(uuid)            to authenticated, service_role;
grant execute on function public.ff_order_waiver_claims(uuid,uuid[])     to authenticated, service_role;
grant execute on function public.ff_waiver_board(uuid)                   to authenticated, service_role;
-- Commissioner-only and cron-only respectively: settling early, or at all, is
-- not a manager's call.
grant execute on function public.ff_seed_waiver_priority(uuid)           to authenticated, service_role;
grant execute on function public.ff_place_unordered_teams(uuid)          to service_role;
grant execute on function public.ff_run_waivers(uuid,integer)            to service_role;
grant execute on function public.ff_process_waivers()                    to service_role;


-- --------------------------------------------- add/drop, minding the wire --
--
-- Free agency and waivers are the same window onto the same pool, so the two
-- have to agree about who is available. Without this, a manager watching the
-- page could sign a player the moment somebody dropped him, and every claim
-- filed against that player would settle on Wednesday against nothing. The
-- claim queue would be decoration.
--
-- Unchanged from 20260905024533 apart from that one check.
create or replace function public.ff_add_drop(
  p_team_id        uuid,
  p_add_player_id  uuid default null,
  p_drop_player_id uuid default null,
  p_week           integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_week    integer;
  v_league  uuid;
  v_team    text;
  v_limit   integer;
  v_size    integer;
  v_txn     uuid;
  v_kind    text;
  v_add     text;
  v_drop    text;
  v_owner   uuid;
  v_lock    timestamptz;
  v_status  text;
begin
  select t.league_id, t.name into v_league, v_team from teams t where t.id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;

  -- auth.uid() IS NULL is the service-role escape hatch, matching ff_team_hub.
  if v_uid is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;

  -- (3) A manager moves in the current week. Only the service role may name one.
  if v_uid is null then
    v_week := coalesce(p_week, ff_current_week());
  else
    v_week := ff_current_week();
    if p_week is not null and p_week <> v_week then
      raise exception 'you can only move in the current week (week %)', v_week;
    end if;
  end if;

  -- (1) No free agency until the draft is over.
  select d.status::text into v_status
    from drafts d where d.league_id = v_league
   order by d.started_at nulls last, d.id limit 1;
  if v_status is null then
    raise exception 'this league has no draft yet';
  elsif v_status <> 'complete' then
    raise exception 'the draft is not finished — no signings until it is';
  end if;

  -- (2) One move at a time in this league, for the rest of this transaction.
  perform pg_advisory_xact_lock(hashtext('ff_add_drop:' || v_league::text));

  if p_add_player_id is null and p_drop_player_id is null then
    raise exception 'nothing to do: name a player to add, to drop, or both';
  end if;
  if p_add_player_id is not null and p_add_player_id = p_drop_player_id then
    raise exception 'cannot add and drop the same player';
  end if;

  -- ------------------------------------------------------------- the drop --
  if p_drop_player_id is not null then
    select o.team_id into v_owner
      from ff_owner_at(v_league, v_week) o where o.player_id = p_drop_player_id;
    if v_owner is distinct from p_team_id then
      raise exception 'you cannot drop a player you do not own';
    end if;

    v_lock := ff_lock_time(p_drop_player_id, v_week);
    if v_lock is not null and v_lock <= now() then
      raise exception 'his game has already kicked off';
    end if;

    select p.full_name into v_drop from players p where p.id = p_drop_player_id;
  end if;

  -- -------------------------------------------------------------- the add --
  if p_add_player_id is not null then
    if not exists (select 1 from draft_pool dp where dp.id = p_add_player_id) then
      raise exception 'that player is not in the pool';
    end if;

    select o.team_id into v_owner
      from ff_owner_at(v_league, v_week) o where o.player_id = p_add_player_id;
    if v_owner is not null then
      raise exception 'that player is already on a roster';
    end if;

    -- On waivers is not the same as available. A dropped player belongs to
    -- whoever has the best claim on Wednesday, not to whoever refreshes the
    -- page first — which, without this, is exactly what he belonged to.
    if exists (select 1 from ff_on_waivers(v_league) w where w.player_id = p_add_player_id) then
      raise exception 'that player is on waivers until % — put in a claim instead',
        to_char(ff_next_waiver_run(v_league, now()), 'Dy DD Mon HH24:MI') || ' UTC';
    end if;

    -- Adding a man whose game is under way would claim points already on the
    -- board, which is the whole reason a lock exists.
    v_lock := ff_lock_time(p_add_player_id, v_week);
    if v_lock is not null and v_lock <= now() then
      raise exception 'his game has already kicked off';
    end if;

    select p.full_name into v_add from players p where p.id = p_add_player_id;
  end if;

  -- -------------------------------------------------------- the size cap --
  select jsonb_array_length(l.roster_slots) into v_limit from leagues l where l.id = v_league;
  select count(*) into v_size from ff_owner_at(v_league, v_week) o where o.team_id = p_team_id;

  v_size := v_size
          + (case when p_add_player_id  is not null then 1 else 0 end)
          - (case when p_drop_player_id is not null then 1 else 0 end);

  if v_limit is not null and v_size > v_limit then
    raise exception 'your roster is full at % — drop someone in the same move', v_limit;
  end if;

  -- ------------------------------------------------------------- the log --
  v_kind := case
    when p_add_player_id is not null and p_drop_player_id is not null then 'add_drop'
    when p_add_player_id is not null then 'add'
    else 'drop' end;

  insert into transactions (league_id, kind, week, actor_id)
  values (v_league, v_kind, v_week, v_uid)
  returning id into v_txn;

  if p_drop_player_id is not null then
    insert into transaction_items (transaction_id, player_id, from_team_id, to_team_id, seq)
    values (v_txn, p_drop_player_id, p_team_id, null, 0);
  end if;
  if p_add_player_id is not null then
    insert into transaction_items (transaction_id, player_id, from_team_id, to_team_id, seq)
    values (v_txn, p_add_player_id, null, p_team_id, 1);
  end if;

  perform ff_materialize_roster(p_team_id, v_week);

  insert into activity_events (league_id, event_type, headline, detail, actor_id, source_type, source_id)
  values (
    v_league, 'transaction',
    left(v_team || ' ' || case
      when v_kind = 'add_drop' then 'signed ' || v_add || ' and let ' || v_drop || ' go'
      when v_kind = 'add'      then 'signed ' || v_add
      else 'let ' || v_drop || ' go' end, 140),
    'Week ' || v_week, v_uid, 'transaction', v_txn
  );

  return jsonb_build_object(
    'transaction_id', v_txn,
    'kind', v_kind,
    'week', v_week,
    'added', v_add,
    'dropped', v_drop,
    'roster_size', v_size,
    'roster_limit', v_limit
  );
end $$;

-- ------------------------------------------------------------- the wire, live --
-- useLive subscribes to these, and a subscription to an unpublished table is a
-- 60-second poll wearing a costume. The existing live features register the
-- same way (20260826022547, 20260827025419).
do $$ begin alter publication supabase_realtime add table public.waiver_claims;
  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.waiver_runs;
  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.transactions;
  exception when duplicate_object then null; end $$;
