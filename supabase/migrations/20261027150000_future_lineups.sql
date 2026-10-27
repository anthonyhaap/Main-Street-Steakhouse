-- ============================================================================
-- Lineups for weeks that have not come yet.
--
-- The desk has always offered all eighteen weeks, and only the current one
-- worked. `rosters` rows for a week are written by ff_materialize_roster, and
-- the only callers are the daily roll (the current week) and the roster moves
-- (the week they take effect). So week 9, looked at in week 8, had no rows:
-- the hub drew an empty roster, and ff_set_lineup updated nothing and said it
-- had — it counted the keys it was handed, not the rows it changed.
--
-- A manager going away for the weekend, or planning around a bye, needs to
-- set week 9 now. Three changes make that work:
--
--   * ff_planned_roster says what a week ahead will look like without writing
--     anything: the players he will own then, in the slots of the latest
--     lineup set on or before it. The hub reads it in place of `rosters`.
--     Looking must not write: a week materialized just because somebody
--     opened it would freeze a copy of today's lineup, and the changes he
--     makes to this week afterwards would stop carrying forward.
--
--   * ff_set_lineup materializes a future week before it writes to it, so a
--     move ahead of time lands on real rows. It also refuses a player who is
--     not on that week's roster, rather than reporting a change it did not
--     make.
--
--   * ff_materialize_roster inherits from the latest earlier week that has a
--     lineup, not strictly the week before. Set week 10 while it is week 8 and
--     week 11 should start from week 10's plan, even though week 9 was filled
--     in later; and nothing lost when a week in between was never written.
--
-- Current and past weeks read exactly what they read before. `rosters` is what
-- scoring reads, so the desk shows it verbatim for any week that has started.
-- ============================================================================

-- ------------------------------------------------------- the inheritance --
-- Restated whole from 20260905022429; the only change is which week a fresh
-- one inherits its slots from.
create or replace function public.ff_materialize_roster(p_team_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league uuid;
  v_fresh  boolean;
  v_from   integer;
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

  -- The latest lineup set before this week, which is usually last week's but
  -- need not be: a week set ahead of time skips the ones in between.
  select max(r.week) into v_from
    from rosters r where r.team_id = p_team_id and r.week < p_week;

  insert into rosters (team_id, player_id, week, slot, locked_at)
  select p_team_id, o.player_id, p_week,
         case when v_fresh then coalesce(prev.slot, 'BN') else 'BN' end,
         ff_lock_time(o.player_id, p_week)
    from _owned o
    left join lateral (
      select r.slot from rosters r
       where r.team_id = p_team_id and r.week = v_from
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

-- ------------------------------------------------------------- the plan --
-- A week's roster as the desk should draw it.
--
-- A week that has begun — or has rows — and is not ahead of the current one
-- is the cache, verbatim. A week ahead (or the current week before the roll
-- has reached it) is derived the way ff_materialize_roster would build it:
-- who he will own that week, from the ledger, in the slots of the latest
-- lineup on or before it, with anyone new on the bench. A move logged since
-- the week was written shows here before the roll catches the cache up.
create or replace function public.ff_planned_roster(p_team_id uuid, p_week integer)
returns table (player_id uuid, slot text, locked_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_league uuid;
  v_now    integer := ff_current_week();
  v_from   integer;
begin
  select league_id into v_league from teams where id = p_team_id;

  if p_week < v_now
     or (p_week = v_now and exists (select 1 from rosters r
                                     where r.team_id = p_team_id and r.week = p_week)) then
    return query
      select r.player_id, r.slot, r.locked_at
        from rosters r where r.team_id = p_team_id and r.week = p_week;
    return;
  end if;

  select max(r.week) into v_from
    from rosters r where r.team_id = p_team_id and r.week <= p_week;

  return query
    select o.player_id, coalesce(b.slot, 'BN'), ff_lock_time(o.player_id, p_week)
      from ff_owner_at(v_league, p_week) o
      left join rosters b
        on b.team_id = p_team_id and b.week = v_from and b.player_id = o.player_id
     where o.team_id = p_team_id;
end $$;

comment on function public.ff_planned_roster(uuid, integer) is
  'A week''s roster for display: rosters verbatim once the week is under way, otherwise derived from ownership and the latest lineup set on or before it. Writes nothing.';

-- ------------------------------------------------------------- the write --
-- Restated from the live body (20260810010845 as rewritten by 20260909194727's
-- co-owner pass, so the guard is the ff_seat_team spelling).
create or replace function public.ff_set_lineup(p_team_id uuid, p_week int, p_assignments jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_league uuid; v_n int := 0; k text; v_slot text; v_pid uuid; v_pos text; v_lock timestamptz;
        v_now int := ff_current_week();
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  if auth.uid() is not null and not exists (
    select 1 from teams t join leagues l on l.id = t.league_id
    where t.id = p_team_id and (t.id = public.ff_seat_team(t.league_id, auth.uid()) or l.commissioner_id = auth.uid())
  ) then raise exception 'not your team'; end if;

  -- A week ahead has no rows until something writes them, and this is the
  -- something. Re-run on every write so a move made since the week was first
  -- written (a pickup, a trade) is on it before the lineup is.
  if p_week > v_now
     or (p_week = v_now and not exists (select 1 from rosters
                                        where team_id = p_team_id and week = p_week)) then
    perform ff_materialize_roster(p_team_id, p_week);
  end if;

  for k in select jsonb_object_keys(p_assignments) loop
    v_pid  := k::uuid;
    v_slot := p_assignments->>k;
    select position into v_pos from players where id = v_pid;
    if not ff_slot_ok(v_slot, v_pos) then
      raise exception '% cannot play in the % slot', v_pos, v_slot;
    end if;
    select locked_at into v_lock from rosters
     where team_id = p_team_id and week = p_week and player_id = v_pid;
    if not found then
      raise exception 'that player is not on this roster in week %', p_week;
    end if;
    if v_lock is not null and v_lock <= now() then
      raise exception 'that player is locked - his game has already kicked off';
    end if;
    update rosters set slot = v_slot
     where team_id = p_team_id and week = p_week and player_id = v_pid;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

-- --------------------------------------------------------------- the read --
-- ff_team_hub is twenty-odd kilobytes, and 20260909194727 rewrote its guard
-- in the catalogue rather than in a file — restating it from any file here
-- would put the old owner_id check back. So, the same way: read it out, swap
-- the one source its roster comes from, and stop if that source is not there.
do $hub$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef('public.ff_team_hub(uuid, integer)'::regprocedure) into v_src;
  v_new := regexp_replace(v_src,
    'from rosters r\s+join players p on p\.id = r\.player_id\s+where r\.team_id = p_team_id and r\.week = v_week',
    E'from public.ff_planned_roster(p_team_id, v_week) r\n      join players p on p.id = r.player_id');
  if v_new = v_src then
    raise exception 'future lineups: ff_team_hub no longer reads its roster the way this migration expects';
  end if;
  execute v_new;
end $hub$;

-- --------------------------------------------------------------- the grants --
-- Internal: it reads any team's roster with no membership check of its own.
-- The hub, which does check, calls it as the definer.
revoke execute on function public.ff_planned_roster(uuid, integer) from public, anon, authenticated;
grant  execute on function public.ff_planned_roster(uuid, integer) to service_role;
