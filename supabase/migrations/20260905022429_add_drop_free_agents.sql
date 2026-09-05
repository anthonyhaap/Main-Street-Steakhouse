-- ============================================================================
-- Add / drop: free agents, and a transaction log that is the truth.
--
-- Until now a roster existed only as rows in `rosters`, one set per week, and
-- the only thing that ever wrote them was `ff_seed_rosters`, seeded from
-- `draft_picks` and called by hand for week 1. Nothing carried a roster into
-- week 2. That was survivable while the league had not kicked off and fatal the
-- moment anyone wanted to change their team.
--
-- So ownership stops being a set of week-scoped rows and becomes something
-- derived: **a player belongs to the team his last transaction gave him to, or
-- to the team that drafted him if he has none.** `transactions` is the log,
-- `ff_owner_at` is the derivation, and `rosters` is demoted to a cache that
-- `ff_materialize_roster` rebuilds from it. Every existing reader — the team
-- hub, `roster_points`, scoring, standings, the recaps — keeps reading
-- `rosters` and does not change.
--
-- The log is a header plus items rather than one flat row, because the next
-- three things asked of it are waivers, trades and a transaction history. A
-- trade is one header with four items; a waiver claim is one header with a
-- status; an add/drop is one header with two. None of those need a new shape.
-- ============================================================================

-- ------------------------------------------------------------------- the log --

create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  kind       text not null check (kind in ('add','drop','add_drop','trade','waiver')),
  -- The week the move takes effect. Ownership is asked for as of a week, so
  -- this is what makes the derivation deterministic rather than "whatever the
  -- clock said" — and it is what lets a waiver claim be logged before it runs.
  week       integer not null check (week between 1 and 25),
  actor_id   uuid references auth.users(id) on delete set null,
  note       text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  -- `created_at` is not a total order. Inside one database transaction now()
  -- is frozen, so two moves logged together tie, and the derivation below then
  -- picks whichever the tiebreak happens to favour rather than the later one.
  -- This sequence is the order things actually happened in.
  ord        bigserial not null
);
create index if not exists transactions_league_idx
  on public.transactions (league_id, week desc, ord desc);

comment on table public.transactions is
  'Every roster move in the league. With draft_picks this is the whole truth about who owns whom; rosters is a cache derived from it.';

create table if not exists public.transaction_items (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  player_id      uuid not null references public.players(id),
  -- NULL on either side is the free agent pool: from_team NULL is a pickup,
  -- to_team NULL is a drop. Both NULL would say nothing happened.
  from_team_id   uuid references public.teams(id) on delete cascade,
  to_team_id     uuid references public.teams(id) on delete cascade,
  seq            integer not null default 0,
  constraint transaction_items_somewhere
    check (from_team_id is not null or to_team_id is not null),
  constraint transaction_items_not_a_loop
    check (from_team_id is distinct from to_team_id)
);
create index if not exists transaction_items_txn_idx
  on public.transaction_items (transaction_id, seq);
create index if not exists transaction_items_player_idx
  on public.transaction_items (player_id);

alter table public.transactions      enable row level security;
alter table public.transaction_items enable row level security;

-- Readable by the league, writable only through the RPCs below. A manager who
-- could insert here directly could give himself any player in football.
drop policy if exists transactions_read on public.transactions;
create policy transactions_read on public.transactions
  for select to authenticated using (public.ff_is_member());
drop policy if exists transaction_items_read on public.transaction_items;
create policy transaction_items_read on public.transaction_items
  for select to authenticated using (public.ff_is_member());

revoke all on table public.transactions      from public, anon;
revoke all on table public.transaction_items from public, anon;
grant select on table public.transactions      to authenticated;
grant select on table public.transaction_items to authenticated;

-- --------------------------------------------------------------- ownership --

-- Who owns whom, as of a week. One row per player who is owned by anybody;
-- a player dropped and unclaimed simply does not appear.
--
-- The rule is "the last word wins": the most recent item touching a player at
-- or before the week decides, and its `to_team_id` is the answer — NULL meaning
-- he went back to the pool. A player with no items at all is still where the
-- draft put him. The full outer join is what covers all three cases: drafted
-- and never moved, moved after being drafted, and never drafted at all
-- (a free agent somebody picked up).
create or replace function public.ff_owner_at(p_league_id uuid, p_week integer)
returns table (player_id uuid, team_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with drafted as (
    select dp.player_id, dp.team_id
      from draft_picks dp
      join drafts d on d.id = dp.draft_id
     where d.league_id = p_league_id
  ),
  last_move as (
    select distinct on (i.player_id)
           i.player_id, i.to_team_id
      from transaction_items i
      join transactions t on t.id = i.transaction_id
     where t.league_id = p_league_id
       and t.week <= p_week
     -- Latest wins: the later week first, then the later log entry. `seq` only
     -- orders items inside one transaction and never decides between two.
     order by i.player_id, t.week desc, t.ord desc, i.seq desc
  )
  select coalesce(m.player_id, d.player_id) as player_id,
         case when m.player_id is not null then m.to_team_id else d.team_id end as team_id
    from drafted d
    full outer join last_move m on m.player_id = d.player_id
   where case when m.player_id is not null then m.to_team_id else d.team_id end is not null
$$;

comment on function public.ff_owner_at(uuid, integer) is
  'Derived ownership as of a week: last transaction wins, else the drafting team. Players in the free agent pool are absent.';

-- ------------------------------------------------------------ the cache --

-- Rebuild one team's `rosters` rows for one week from derived ownership.
--
-- `rosters` is no longer where ownership lives, but it is still where the slot
-- and the per-player lock live, and every reader in the app goes through it. So
-- it is kept, and this is the only thing that writes it after the draft.
--
-- A week that has no rows yet inherits its lineup from the week before, for
-- players still owned: a manager who set a lineup in week 5 and changed nothing
-- should not find week 6 benched. Slots repeat in `roster_slots` (two RB, six
-- BN), so copying them needs no de-duplication — a dropped starter simply
-- leaves his slot empty, which is the honest result.
create or replace function public.ff_materialize_roster(p_team_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league uuid;
  v_fresh  boolean;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;

  -- A league with no picks and no moves has no ownership to derive from — it
  -- has not drafted, or the draft was reset. That is not "every roster is
  -- empty": treating it that way would delete rosters this function cannot
  -- rebuild. The daily roll runs against exactly this state all preseason, so
  -- the guard is the normal case and not a corner one.
  if not exists (select 1 from draft_picks dp
                   join drafts d on d.id = dp.draft_id where d.league_id = v_league)
     and not exists (select 1 from transactions t where t.league_id = v_league) then
    return (select count(*) from rosters where team_id = p_team_id and week = p_week);
  end if;

  create temp table _owned on commit drop as
    select o.player_id from ff_owner_at(v_league, p_week) o where o.team_id = p_team_id;

  delete from rosters r
   where r.team_id = p_team_id and r.week = p_week
     and not exists (select 1 from _owned o where o.player_id = r.player_id);

  select not exists (select 1 from rosters where team_id = p_team_id and week = p_week)
    into v_fresh;

  insert into rosters (team_id, player_id, week, slot, locked_at)
  select p_team_id, o.player_id, p_week,
         case when v_fresh then coalesce(prev.slot, 'BN') else 'BN' end,
         ff_lock_time(o.player_id, p_week)
    from _owned o
    left join lateral (
      select r.slot from rosters r
       where r.team_id = p_team_id and r.week = p_week - 1
         and r.player_id = o.player_id
    ) prev on v_fresh
   where not exists (select 1 from rosters r
                      where r.team_id = p_team_id and r.week = p_week
                        and r.player_id = o.player_id);

  -- Kickoffs move. A roster row carried forward from a week whose schedule has
  -- since been re-loaded would otherwise keep a stale lock.
  update rosters r set locked_at = ff_lock_time(r.player_id, p_week)
   where r.team_id = p_team_id and r.week = p_week
     and r.locked_at is distinct from ff_lock_time(r.player_id, p_week);

  drop table _owned;
  return (select count(*) from rosters where team_id = p_team_id and week = p_week);
end $$;

-- Every team in one call, for the weekly roll-forward and for /admin.
create or replace function public.ff_ensure_week_rosters(p_league_id uuid, p_week integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_week integer := coalesce(p_week, ff_current_week()); v_team uuid; v_n integer := 0;
begin
  for v_team in select id from teams where league_id = p_league_id loop
    v_n := v_n + ff_materialize_roster(v_team, v_week);
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------------ free agents --

-- The pool, minus everyone who is owned as of the week. `draft_pool` already
-- carries the projection, the rank, the headshot id and the injury, so this is
-- that view with the owned players taken out and a search on top.
create or replace function public.ff_free_agents(
  p_league_id uuid,
  p_week      integer default null,
  p_position  text    default null,
  p_query     text    default null,
  p_limit     integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(fa) order by fa.overall_rank nulls last, fa.full_name), '[]'::jsonb)
  from (
    select dp.*
      from draft_pool dp
     where not exists (
             select 1 from ff_owner_at(p_league_id, coalesce(p_week, ff_current_week())) o
              where o.player_id = dp.id)
       and (p_position is null or p_position = 'ALL' or dp.position = p_position)
       and (p_query is null or p_query = ''
            or dp.full_name ilike '%' || p_query || '%'
            or coalesce(dp.nfl_team, '') ilike '%' || p_query || '%')
     order by dp.overall_rank nulls last, dp.full_name
     limit greatest(1, least(coalesce(p_limit, 100), 300))
  ) fa
  where ff_is_member() or auth.uid() is null
$$;

-- ------------------------------------------------------------- the move --

-- `transaction` joins the list so a pickup can be posted to the feed. The
-- existing kinds stay untouched; 'waiver' and 'trade' were already there,
-- waiting for the features that will use them.
alter table public.activity_events drop constraint if exists activity_events_event_type_check;
alter table public.activity_events add  constraint activity_events_event_type_check
  check (event_type in ('announcement','deadline','draft','trade','waiver',
                        'score','record','challenge','system','transaction'));

-- One manager move: pick a free agent up, let a player go, or both at once.
--
-- Both at once is not a convenience — it is the only way to do either when the
-- roster is full, and doing it as two calls would leave a manager one crash
-- away from a fifteen-man roster with a hole in it. One transaction, two items,
-- and the size check applies to the net result.
--
-- Deliberately owner-only. A commissioner can already fix a roster through the
-- service role, and letting him move another manager's players from the app is
-- a different feature with a different audit trail.
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
  v_week    integer := coalesce(p_week, ff_current_week());
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
begin
  select t.league_id, t.name into v_league, v_team from teams t where t.id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;

  -- auth.uid() IS NULL is the service-role escape hatch, matching ff_team_hub.
  if v_uid is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;

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

-- ------------------------------------------------------------- the ledger --

-- The league's moves, newest first, with both sides of each one resolved to
-- names. This is what a transaction history page reads.
create or replace function public.ff_transactions(p_league_id uuid, p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.ord desc), '[]'::jsonb)
  from (
    select t.id, t.kind, t.week, t.created_at, t.ord,
           coalesce(jsonb_agg(jsonb_build_object(
             'player_id', i.player_id,
             'player',    p.full_name,
             'position',  p.position,
             'nfl_team',  p.nfl_team,
             'from_team', ft.name,
             'to_team',   tt.name
           ) order by i.seq), '[]'::jsonb) as items
      from transactions t
      join transaction_items i on i.transaction_id = t.id
      join players p  on p.id = i.player_id
      left join teams ft on ft.id = i.from_team_id
      left join teams tt on tt.id = i.to_team_id
     where t.league_id = p_league_id
     group by t.id
     order by t.ord desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
  where ff_is_member() or auth.uid() is null
$$;

-- ------------------------------------------------------------- the grants --
-- Matching 20260824034323 / 20260824034350: members execute, anon never does.
revoke execute on function public.ff_owner_at(uuid,integer)              from public, anon;
revoke execute on function public.ff_materialize_roster(uuid,integer)    from public, anon;
revoke execute on function public.ff_ensure_week_rosters(uuid,integer)   from public, anon;
revoke execute on function public.ff_add_drop(uuid,uuid,uuid,integer)    from public, anon;
revoke execute on function public.ff_free_agents(uuid,integer,text,text,integer) from public, anon;
revoke execute on function public.ff_transactions(uuid,integer)          from public, anon;

grant execute on function public.ff_owner_at(uuid,integer)              to authenticated, service_role;
grant execute on function public.ff_add_drop(uuid,uuid,uuid,integer)    to authenticated, service_role;
grant execute on function public.ff_free_agents(uuid,integer,text,text,integer) to authenticated, service_role;
grant execute on function public.ff_transactions(uuid,integer)          to authenticated, service_role;
grant execute on function public.ff_ensure_week_rosters(uuid,integer)   to authenticated, service_role;
grant execute on function public.ff_materialize_roster(uuid,integer)    to service_role;

-- ------------------------------------------------------- ownership, drawn --

-- Ownership with enough of the player attached to render it. The players page
-- needs this to mark who is taken, and the drop picker needs it to list your
-- own roster — deliberately the same call, because "who owns whom" is one
-- question and asking it twice is how two screens start to disagree.
--
-- It reads derived ownership, not `rosters`, so it is right for a week that
-- has never been materialized.
create or replace function public.ff_pool_owners(p_league_id uuid, p_week integer default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', o.player_id,
           'player',    p.full_name,
           'position',  p.position,
           'nfl_team',  p.nfl_team,
           'team_id',   o.team_id,
           'team',      t.name
         ) order by t.name, p.full_name), '[]'::jsonb)
    from ff_owner_at(p_league_id, coalesce(p_week, ff_current_week())) o
    join players p on p.id = o.player_id
    join teams   t on t.id = o.team_id
   where ff_is_member() or auth.uid() is null
$$;

-- ------------------------------------------------------- the roll forward --

-- Ownership is derived, but `rosters` is what the team hub, the scoreboard and
-- every scoring path actually read. Something has to keep the cache abreast of
-- the week, and "the commissioner remembers to press a button" is what left
-- week 2 empty in the first place.
--
-- Daily rather than weekly, and for the current week: the same reasoning as
-- ff_post_weekly_recaps — a flexed game or a missed run should not cost a
-- league its rosters, and materializing a week that is already correct is a
-- no-op.
create or replace function public.ff_roll_rosters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid; v_n integer := 0;
begin
  for v_league in select id from leagues loop
    v_n := v_n + ff_ensure_week_rosters(v_league, ff_current_week());
  end loop;
  return v_n;
end $$;

select cron.schedule('roll-rosters', '20 9 * * *', 'select public.ff_roll_rosters()');

revoke execute on function public.ff_pool_owners(uuid,integer) from public, anon;
revoke execute on function public.ff_roll_rosters()            from public, anon;
grant  execute on function public.ff_pool_owners(uuid,integer) to authenticated, service_role;
grant  execute on function public.ff_roll_rosters()            to service_role;
