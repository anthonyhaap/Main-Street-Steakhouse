-- ============================================================================
-- Add/drop: three holes found in review, and a reset that forgets.
--
-- `20260905022429` shipped ff_add_drop with the manager's own week, no
-- serialization, and no opinion about whether the draft had happened. All three
-- were found by review on the pull request, and all three are reachable by any
-- authenticated team owner, so they are fixed here rather than in the file that
-- introduced them — that one is already recorded and must not change.
-- ============================================================================

-- --------------------------------------------------- the move, with guards --
--
-- 1. The draft must be COMPLETE. Before that, ownership has two authors: a
--    signing writes a transaction, and `ff_make_pick` writes a draft pick, and
--    they do not see each other. `ff_make_pick` rejects a duplicate through a
--    unique constraint on draft_picks alone, so a player signed pre-draft is
--    still draftable — and `ff_owner_at` then hands him to whoever signed him,
--    stripping the team that spent a pick. There is no free agency during a
--    draft anyway; the draft IS the allocation.
--
-- 2. One move at a time per league. Two managers claiming the same free agent
--    both read a null owner, both insert, and both are told they succeeded;
--    `ff_owner_at` then picks the later `ord` and one of them has a roster
--    cache holding a player he does not own. A unique constraint cannot express
--    "current owner" in a log, so the serialization is an advisory lock held
--    for the transaction. It is league-wide rather than per player, which also
--    closes the same race on the roster-size check, and costs nothing in a
--    twelve-man league.
--
-- 3. The week is not the caller's to choose. `p_week` was accepted from the
--    browser as anything from 1 to 25, and `ff_owner_at` orders by week before
--    `ord` — so a claim filed for week 25 sits invisible against the current
--    week and then overrides every legitimate move made in between. A manager
--    now gets the current week and nothing else. The parameter stays for the
--    service role, which is what the tests and any future waiver run use.
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

-- ------------------------------------------------------- the reset, honest --
--
-- Resetting a draft deleted the picks and left the transactions, which is the
-- worst of both: `ff_owner_at` gives an old move precedence over the new draft
-- pick, so a player dropped before the reset stays unowned and a player signed
-- before it stays with his old team no matter who redrafts him. A reset is
-- destructive on purpose, so it now clears the league's moves and its derived
-- roster cache too, and says so.
create or replace function public.ff_reset_draft(p_draft_id uuid)
returns drafts
language plpgsql
security definer
set search_path = public
as $$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);

  delete from draft_picks where draft_id = p_draft_id;

  -- Ownership is derived from picks AND moves. Clearing one without the other
  -- leaves a league whose rosters disagree with its draft board.
  delete from transactions where league_id = v_draft.league_id;
  delete from rosters r using teams t
   where t.id = r.team_id and t.league_id = v_draft.league_id;

  update drafts set status = 'setup',
         current_pick = 1,
         pick_deadline = null,
         remaining_ms = null,
         started_at = null,
         completed_at = null
   where id = p_draft_id
  returning * into v_draft;

  return v_draft;
end $$;

comment on function public.ff_reset_draft(uuid) is
  'Commissioner only. Deletes every pick, every roster move and the derived roster cache, and returns the draft to setup -- for restarting a test draft. Draft order and team queues are left alone.';
