-- ============================================================================
-- Rosters at the end of the draft.
--
-- The draft finished at 02:30 UTC on 2026-09-09 and every team page was empty.
-- Nothing was wrong with the picks: `draft_picks` held all 180 and `ff_owner_at`
-- derived the right owner for each. But the team hub, the scoreboard and every
-- scoring path read `rosters`, and `rosters` is a cache that only three things
-- ever write: a manager's own move, the commissioner pressing "Seed week 1
-- rosters" on /admin, and `roll-rosters` at 09:20 UTC. The final pick of the
-- draft is the one moment the whole league opens /team at once, and it was also
-- the one moment nothing filled the cache — the room emptied out to twelve blank
-- rosters and a cron seven hours away.
--
-- So the last pick now does it. `ff_make_pick` already knows when it has closed
-- the board (it is the statement that sets status = 'complete'); it now hands the
-- league to `ff_rosters_after_draft`, which materializes every team for the
-- current week and gives each an opening lineup. Undoing a pick out of a
-- complete draft takes that player back out of the cache, so the board and the
-- team pages never disagree, and a migration-time backfill covers the draft that
-- has already finished.
-- ============================================================================

-- ------------------------------------------------------- after the draft --

-- Every team's roster for the week, from derived ownership, plus an opening
-- lineup for any team that has nobody in a starting slot yet.
--
-- The lineup half is what `ff_seed_rosters` did and `ff_materialize_roster`
-- deliberately does not: a fresh week with no week before it puts everyone on
-- the bench, which is right for week 6 and wrong for the night the roster comes
-- into existence — a manager who drafted a quarterback in the first round should
-- not open the app to nine empty slots. Slots are filled in `roster_slots`
-- order, best remaining player first, where best means the season projection
-- under this league's rules (the number the draft board showed), then ADP, and
-- a man on bye this week goes to the back of the line. Only a team with NO
-- starters is touched, so a lineup a manager has already set is never reshuffled
-- when this runs again.
--
-- Not gated on the commissioner, because it is called from inside the final
-- pick, which any manager may make. Granted to service_role alone; the RPCs that
-- reach it are SECURITY DEFINER and run as the owner.
create or replace function public.ff_rosters_after_draft(p_league_id uuid, p_week integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week   integer := greatest(1, coalesce(p_week, ff_current_week()));
  v_season integer;
  v_slots  text[];
  v_team   uuid;
  v_slot   text;
  v_pid    uuid;
  v_n      integer := 0;
begin
  select l.season, array(select jsonb_array_elements_text(l.roster_slots))
    into v_season, v_slots
    from leagues l where l.id = p_league_id;
  if v_season is null then raise exception 'league % not found', p_league_id; end if;

  for v_team in
    select t.id from teams t where t.league_id = p_league_id order by t.draft_slot nulls last, t.name
  loop
    v_n := v_n + ff_materialize_roster(v_team, v_week);

    if exists (select 1 from rosters r
                where r.team_id = v_team and r.week = v_week and r.slot <> 'BN') then
      continue;
    end if;

    foreach v_slot in array v_slots loop
      if v_slot = 'BN' then continue; end if;

      select r.player_id into v_pid
        from rosters r
        join players p on p.id = r.player_id
        left join player_season_projections sp
               on sp.player_id = p.id and sp.season = v_season
        left join player_adp a
               on a.player_id = p.id and a.season = v_season and a.format = 'ppr' and a.teams = 12
       where r.team_id = v_team and r.week = v_week and r.slot = 'BN'
         and ff_slot_ok(v_slot, p.position)
       order by case when p.bye_week = v_week then 1 else 0 end,
                sp.points_total desc nulls last,
                a.adp asc nulls last,
                p.full_name
       limit 1;

      if v_pid is not null then
        update rosters set slot = v_slot
         where team_id = v_team and week = v_week and player_id = v_pid;
      end if;
      v_pid := null;
    end loop;
  end loop;

  return v_n;
end $$;

comment on function public.ff_rosters_after_draft(uuid, integer) is
  'Materialize every team''s roster for the week from derived ownership and give any team with no starters an opening lineup (best projection first, bye week last). Runs from the final pick of the draft; service role only.';

revoke execute on function public.ff_rosters_after_draft(uuid, integer) from public, anon, authenticated;
grant  execute on function public.ff_rosters_after_draft(uuid, integer) to service_role;

-- ----------------------------------------------------------- the last pick --

-- Unchanged from 20260809015628 except for the block at the end. The roster
-- build is wrapped: the final pick of a draft must not fail because a cache
-- could not be rebuilt — under ff_tick_drafts that would be an autopick retried
-- every five seconds forever, and the board never closing. A failure is logged
-- to ingest_log instead, and the daily roll materializes the week regardless.
create or replace function ff_make_pick(
  p_draft_id uuid, p_player_id uuid, p_team_id uuid default null,
  p_made_by uuid default null, p_autopick boolean default false, p_force boolean default false
) returns draft_picks language plpgsql security definer set search_path = public as $$
declare
  v_draft drafts%rowtype; v_count int; v_team uuid; v_round int; v_total int;
  v_pick draft_picks%rowtype; v_onclock uuid;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  if p_force then perform ff_assert_commissioner(v_draft.league_id); end if;
  if v_draft.status = 'complete' then raise exception 'draft is already complete'; end if;
  if v_draft.status <> 'active' and not p_force then
    raise exception 'draft is % - only a forced (commissioner) pick is allowed', v_draft.status;
  end if;

  select team_count into v_count from leagues where id = v_draft.league_id;
  v_total   := v_count * v_draft.rounds;
  v_onclock := ff_team_on_clock(p_draft_id);
  v_team    := coalesce(p_team_id, v_onclock);

  if not p_force and p_team_id is not null and p_team_id <> v_onclock then
    raise exception 'team % is not on the clock', p_team_id;
  end if;

  v_round := ff_round_for_pick(v_draft.current_pick, v_count);

  insert into draft_picks (draft_id, pick_number, round, team_id, player_id, is_autopick, made_by)
  values (p_draft_id, v_draft.current_pick, v_round, v_team, p_player_id, p_autopick, p_made_by)
  returning * into v_pick;

  update drafts
     set current_pick  = current_pick + 1,
         pick_deadline = case
                           when current_pick + 1 > v_total then null
                           when status = 'active' then now() + make_interval(secs => pick_seconds)
                           else null end,
         status        = case when current_pick + 1 > v_total then 'complete'::draft_status else status end,
         completed_at  = case when current_pick + 1 > v_total then now() else completed_at end
   where id = p_draft_id;

  -- The board is full: every team gets its roster now, not at 09:20.
  if v_draft.current_pick + 1 > v_total then
    begin
      perform ff_rosters_after_draft(v_draft.league_id);
    exception when others then
      insert into ingest_log (source, event, detail)
      values ('draft', 'rosters_after_draft_failed',
              jsonb_build_object('draft', p_draft_id, 'league', v_draft.league_id, 'error', sqlerrm));
    end;
  end if;

  return v_pick;
end; $$;

comment on function ff_make_pick(uuid, uuid, uuid, uuid, boolean, boolean) is
  'Record a pick and advance the clock. The pick that fills the board completes the draft and builds every team''s roster for the current week.';

-- ---------------------------------------------------------------- the undo --

-- Unchanged from 20260809015628 except that undoing a pick out of a complete
-- draft re-materializes that team, so the player leaves its roster the moment
-- he leaves the board. Undoing inside a live draft touches nothing: the cache
-- does not exist until the board is full.
create or replace function ff_undo_last_pick(p_draft_id uuid)
returns draft_picks language plpgsql security definer set search_path = public as $$
declare v_draft drafts%rowtype; v_pick draft_picks%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);
  select * into v_pick from draft_picks where draft_id = p_draft_id order by pick_number desc limit 1;
  if not found then raise exception 'no picks to undo'; end if;
  delete from draft_picks where id = v_pick.id;
  update drafts set current_pick = v_pick.pick_number,
         status = case when status='complete' then 'paused'::draft_status else status end,
         completed_at = null,
         pick_deadline = case when status='active' then now() + make_interval(secs => pick_seconds) else null end
   where id = p_draft_id;

  if v_draft.status = 'complete' then
    perform ff_materialize_roster(v_pick.team_id, greatest(1, ff_current_week()));
  end if;

  return v_pick;
end; $$;

-- ------------------------------------------------------------- the backfill --

-- The draft this was written for has already finished. Any league whose board
-- is full gets its rosters now; a league that has not drafted is untouched, and
-- a team whose lineup is already set keeps it.
do $$
declare v_league uuid;
begin
  for v_league in select d.league_id from drafts d where d.status = 'complete' loop
    perform public.ff_rosters_after_draft(v_league);
  end loop;
end $$;
