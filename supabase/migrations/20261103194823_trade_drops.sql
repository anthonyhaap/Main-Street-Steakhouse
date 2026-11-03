-- ============================================================================
-- Drops inside a trade.
--
-- By midseason every roster in the league sits at the limit, and
-- ff_validate_trade refuses any offer that leaves a side over it. So a 2-for-1
-- could only happen if the team taking two first cut somebody in a separate
-- move — before knowing whether the other side would even say yes. On
-- 2026-11-03 that turned eleven offers away in six minutes.
--
-- Now a trade can carry its own releases, applied in the same transaction as
-- the players moving, so nobody is cut for a deal that never happens:
--
--   * The proposer names their own drops when they make the offer. They are
--     stored in `trade_drops` beside the offer, and the receiver sees them.
--
--   * The receiver names theirs when they accept. Nobody chooses who is cut
--     from somebody else's roster, so an offer that would overfill the
--     receiving side is now allowed to be MADE; it just cannot be accepted
--     until the receiver says who goes.
--
--   * Each side may drop only as many as the trade forces, so a trade is not a
--     back door around the add/drop rules. A dropped player is an ordinary
--     release in the ledger (to_team_id null), so he goes on waivers exactly as
--     one cut through ff_add_drop would.
--
-- Kept in its own table rather than as trade_items with no destination: every
-- reader of trade_items — the desk, the push trigger, the invalidation sweep —
-- assumes an item moves between the two teams, and none of them needs
-- revisiting this way.
--
-- ff_propose_trade and ff_respond_trade gain a trailing p_drops. The old
-- signatures are dropped rather than overloaded, so PostgREST has one function
-- to resolve; p_drops defaults to empty, so a client that never sends it calls
-- the new function exactly as it called the old one.
-- ============================================================================

-- ---------------------------------------------------------------- the table --
create table if not exists public.trade_drops (
  id        uuid primary key default gen_random_uuid(),
  trade_id  uuid not null references public.trades(id) on delete cascade,
  team_id   uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id),
  seq       integer not null default 0,
  constraint trade_drops_one_each unique (trade_id, player_id)
);
create index if not exists trade_drops_player_idx on public.trade_drops (player_id);

alter table public.trade_drops enable row level security;

-- Exactly as private as the offer it belongs to: the two clubs while it is
-- live, the league once it is settled.
drop policy if exists trade_drops_read on public.trade_drops;
create policy trade_drops_read on public.trade_drops
  for select using (
    exists (select 1 from public.trades t
             where t.id = trade_drops.trade_id
               and ff_is_member(t.league_id)
               and (t.status <> 'proposed'
                    or ff_owns_team(t.proposer_team_id)
                    or ff_owns_team(t.receiver_team_id))));

revoke all on table public.trade_drops from public, anon, authenticated;
grant select on table public.trade_drops to authenticated;

-- --------------------------------------------------------- the validator --
-- Restated from 20260905142709 with the drops added. p_b_drops null means the
-- other side has not said who goes yet — an offer being made — and their size
-- is not checked; at acceptance it is always an array, and always checked.
drop function if exists public.ff_validate_trade(uuid, uuid, uuid, uuid[], uuid[], integer);
create function public.ff_validate_trade(
  p_league_id uuid, p_a_team uuid, p_b_team uuid,
  p_a_gives uuid[], p_b_gives uuid[], p_week integer,
  p_a_drops uuid[] default '{}', p_b_drops uuid[] default '{}'
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_deadline integer;
  v_limit    integer;
  v_a_size   integer;
  v_b_size   integer;
  v_bad      uuid;
  v_lock     timestamptz;
  v_pid      uuid;
  v_side     record;
begin
  select d.status::text into v_status from drafts d
   where d.league_id = p_league_id order by d.started_at nulls last, d.id limit 1;
  if v_status is distinct from 'complete' then
    raise exception 'the draft is not finished — no trades until it is';
  end if;

  select coalesce((settings->>'trade_deadline_week')::int, 99),
         jsonb_array_length(roster_slots)
    into v_deadline, v_limit
    from leagues where id = p_league_id;
  if p_week > v_deadline then
    raise exception 'the trade deadline was week % — this is week %', v_deadline, p_week;
  end if;

  if coalesce(array_length(p_a_gives, 1), 0) + coalesce(array_length(p_b_gives, 1), 0) = 0 then
    raise exception 'a trade with nobody in it is not a trade';
  end if;

  -- Each side must own what it is offering, as of now.
  select pid into v_bad from unnest(p_a_gives) pid
   where pid not in (select o.player_id from ff_owner_at(p_league_id, p_week) o where o.team_id = p_a_team);
  if v_bad is not null then
    raise exception '% is not on the offering roster', (select full_name from players where id = v_bad);
  end if;

  select pid into v_bad from unnest(p_b_gives) pid
   where pid not in (select o.player_id from ff_owner_at(p_league_id, p_week) o where o.team_id = p_b_team);
  if v_bad is not null then
    raise exception '% is not on the other roster', (select full_name from players where id = v_bad);
  end if;

  -- Each side's drops: its own players, named once, and not also in the deal.
  for v_side in
    select p_a_team as team, coalesce(p_a_gives, '{}'::uuid[]) as gives, p_a_drops as drops
    union all
    select p_b_team, coalesce(p_b_gives, '{}'::uuid[]), p_b_drops
  loop
    continue when v_side.drops is null;
    if exists (select 1 from unnest(v_side.drops) d where d is null) then
      raise exception 'a drop has to name a player';
    end if;
    if cardinality(v_side.drops) <> (select count(distinct d) from unnest(v_side.drops) d) then
      raise exception 'the same player is dropped twice';
    end if;
    select d into v_bad from unnest(v_side.drops) d where d = any(v_side.gives) limit 1;
    if v_bad is not null then
      raise exception '% is in the trade — he cannot be dropped as well',
        (select full_name from players where id = v_bad);
    end if;
    select d into v_bad from unnest(v_side.drops) d
     where d not in (select o.player_id from ff_owner_at(p_league_id, p_week) o where o.team_id = v_side.team)
     limit 1;
    if v_bad is not null then
      raise exception '% is not on that roster to drop', (select full_name from players where id = v_bad);
    end if;
  end loop;

  -- A man whose game has started belongs to this week's scoreboard, not to a
  -- negotiation — and not to the waiver wire either, so the same holds for
  -- anybody being dropped to make room. Same rule ff_add_drop applies.
  foreach v_pid in array (coalesce(p_a_gives, '{}'::uuid[]) || coalesce(p_b_gives, '{}'::uuid[])
                          || coalesce(p_a_drops, '{}'::uuid[]) || coalesce(p_b_drops, '{}'::uuid[])) loop
    v_lock := ff_lock_time(v_pid, p_week);
    if v_lock is not null and v_lock <= now() then
      raise exception '%''s game has already kicked off',
        (select full_name from players where id = v_pid);
    end if;
  end loop;

  -- Uneven trades are fine; over-full rosters are not.
  select count(*) into v_a_size from ff_owner_at(p_league_id, p_week) o where o.team_id = p_a_team;
  select count(*) into v_b_size from ff_owner_at(p_league_id, p_week) o where o.team_id = p_b_team;
  v_a_size := v_a_size - coalesce(array_length(p_a_gives, 1), 0) + coalesce(array_length(p_b_gives, 1), 0)
            - coalesce(cardinality(p_a_drops), 0);
  v_b_size := v_b_size - coalesce(array_length(p_b_gives, 1), 0) + coalesce(array_length(p_a_gives, 1), 0)
            - coalesce(cardinality(p_b_drops), 0);

  if v_limit is not null and v_a_size > v_limit then
    raise exception 'that would leave the proposing roster at %, over the % man limit — name % to drop',
      v_a_size, v_limit, v_a_size - v_limit;
  end if;
  if v_limit is not null and p_b_drops is not null and v_b_size > v_limit then
    raise exception 'that would leave the other roster at %, over the % man limit — name % to drop',
      v_b_size, v_limit, v_b_size - v_limit;
  end if;
end $$;

-- ------------------------------------------------------- how many must go --
-- What a side's roster comes to after the swap, over the limit, before any
-- drops. Zero when it fits. The cap on drops reads it: a side may let go only
-- as many as the trade forces.
create or replace function public.ff_trade_overflow(
  p_league_id uuid, p_team_id uuid, p_week integer, p_out integer, p_in integer
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0,
    (select count(*)::int from ff_owner_at(p_league_id, p_week) o where o.team_id = p_team_id)
    - p_out + p_in
    - coalesce((select jsonb_array_length(roster_slots) from leagues where id = p_league_id), 2147483647))
$$;

-- --------------------------------------------------------------- the offer --
drop function if exists public.ff_propose_trade(uuid, uuid, uuid[], uuid[], text, uuid);
create function public.ff_propose_trade(
  p_from_team_id uuid, p_to_team_id uuid,
  p_i_give uuid[] default '{}', p_i_get uuid[] default '{}',
  p_message text default null, p_counters_id uuid default null,
  p_drops uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_league uuid;
  v_other  uuid;
  v_week   integer := ff_current_week();
  v_id     uuid;
  v_prior  record;
  v_need   integer;
  v_drops  uuid[] := coalesce(p_drops, '{}'::uuid[]);
begin
  select league_id into v_league from teams where id = p_from_team_id;
  select league_id into v_other  from teams where id = p_to_team_id;
  if v_league is null or v_other is null then raise exception 'team not found'; end if;
  if v_league <> v_other then raise exception 'those teams are not in the same league'; end if;
  if p_from_team_id = p_to_team_id then raise exception 'you cannot trade with yourself'; end if;
  if v_uid is not null and not ff_owns_team(p_from_team_id) then
    raise exception 'that is not your team';
  end if;

  perform pg_advisory_xact_lock(hashtext('ff_add_drop:' || v_league::text));
  -- The other side's drops are theirs to name, at acceptance: null here.
  perform ff_validate_trade(v_league, p_from_team_id, p_to_team_id, p_i_give, p_i_get, v_week,
                            v_drops, null);

  v_need := ff_trade_overflow(v_league, p_from_team_id, v_week,
                              coalesce(cardinality(p_i_give), 0), coalesce(cardinality(p_i_get), 0));
  if cardinality(v_drops) > v_need then
    if v_need = 0 then
      raise exception 'your roster has room for this — nobody needs dropping';
    end if;
    raise exception 'this only needs % dropped, not %', v_need, cardinality(v_drops);
  end if;

  -- A counter answers a live offer made TO you, and closes it.
  if p_counters_id is not null then
    select * into v_prior from trades where id = p_counters_id for update;
    if v_prior.id is null then raise exception 'no such offer to counter'; end if;
    if v_prior.status <> 'proposed' then
      raise exception 'that offer is already %', v_prior.status;
    end if;
    if v_prior.receiver_team_id <> p_from_team_id then
      raise exception 'you can only counter an offer made to you';
    end if;
    -- And it goes back to whoever made it. Without this the browser could
    -- close one manager's offer while sending its answer to a different club
    -- entirely — which is what a counter to a give-me-nothing offer did, since
    -- there was no arriving player to infer the counterparty from.
    if v_prior.proposer_team_id <> p_to_team_id then
      raise exception 'a counter goes back to the team that made the offer';
    end if;
    update trades set status = 'countered', responded_at = now(), responded_by = v_uid,
           outcome = 'answered with a counter'
     where id = p_counters_id;
  end if;

  insert into trades (league_id, proposer_team_id, receiver_team_id, week, message,
                      counters_id, proposed_by)
  values (v_league, p_from_team_id, p_to_team_id, v_week, p_message, p_counters_id, v_uid)
  returning id into v_id;

  insert into trade_items (trade_id, player_id, from_team_id, to_team_id, seq)
  select v_id, pid, p_from_team_id, p_to_team_id, i
    from unnest(coalesce(p_i_give, '{}'::uuid[])) with ordinality as g(pid, i);
  insert into trade_items (trade_id, player_id, from_team_id, to_team_id, seq)
  select v_id, pid, p_to_team_id, p_from_team_id, 100 + i
    from unnest(coalesce(p_i_get, '{}'::uuid[])) with ordinality as g(pid, i);

  insert into trade_drops (trade_id, team_id, player_id, seq)
  select v_id, p_from_team_id, pid, i
    from unnest(v_drops) with ordinality as g(pid, i);

  -- Deliberately no activity_events row here. `activity_events` is readable by
  -- every member, so announcing "A offered B a trade" would tell the league a
  -- negotiation exists and who is in it — which is exactly what the RLS policy
  -- on `trades` is written to prevent. The feed hears about it when it is
  -- accepted, which is when it becomes the league's business.

  return jsonb_build_object('trade_id', v_id, 'week', v_week,
                            'counters', p_counters_id, 'status', 'proposed',
                            'drops', cardinality(v_drops));
end $$;

-- ------------------------------------------------------------- the answer --
drop function if exists public.ff_respond_trade(uuid, text);
create function public.ff_respond_trade(
  p_trade_id uuid, p_response text, p_drops uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_t       record;
  v_gives   uuid[];
  v_gets    uuid[];
  v_a_drops uuid[];
  v_b_drops uuid[] := coalesce(p_drops, '{}'::uuid[]);
  v_need    integer;
  v_txn     uuid;
  v_week    integer;
  v_names   text;
  v_cut     text;
begin
  if p_response not in ('accepted','declined','cancelled') then
    raise exception 'a trade is accepted, declined or cancelled';
  end if;
  if p_response <> 'accepted' and cardinality(v_b_drops) > 0 then
    raise exception 'only an acceptance names who to drop';
  end if;

  select * into v_t from trades where id = p_trade_id for update;
  if v_t.id is null then raise exception 'no such trade'; end if;
  if v_t.status <> 'proposed' then raise exception 'that offer is already %', v_t.status; end if;

  -- Withdrawing is the proposer's; accepting and declining are the receiver's.
  if p_response = 'cancelled' then
    if v_uid is not null and not ff_owns_team(v_t.proposer_team_id) then
      raise exception 'only the team that offered can withdraw it';
    end if;
  elsif v_uid is not null and not ff_owns_team(v_t.receiver_team_id) then
    raise exception 'only the team it was offered to can answer it';
  end if;

  perform pg_advisory_xact_lock(hashtext('ff_add_drop:' || v_t.league_id::text));

  if p_response <> 'accepted' then
    update trades set status = p_response, responded_at = now(), responded_by = v_uid,
           outcome = case when p_response = 'declined' then 'declined' else 'withdrawn' end
     where id = p_trade_id;
    return jsonb_build_object('trade_id', p_trade_id, 'status', p_response);
  end if;

  -- ------------------------------------------------------------- accepted --
  v_week := ff_current_week();
  select array_agg(player_id order by seq) into v_gives
    from trade_items where trade_id = p_trade_id and from_team_id = v_t.proposer_team_id;
  select array_agg(player_id order by seq) into v_gets
    from trade_items where trade_id = p_trade_id and from_team_id = v_t.receiver_team_id;
  select array_agg(player_id order by seq) into v_a_drops
    from trade_drops where trade_id = p_trade_id and team_id = v_t.proposer_team_id;

  -- The week is today's, not the week the offer was made in: a trade agreed on
  -- Tuesday takes effect now, and the deadline applies to when it lands. Both
  -- sides' sizes are checked here, drops and all.
  perform ff_validate_trade(v_t.league_id, v_t.proposer_team_id, v_t.receiver_team_id,
                            coalesce(v_gives, '{}'), coalesce(v_gets, '{}'), v_week,
                            coalesce(v_a_drops, '{}'), v_b_drops);

  -- The receiver is choosing now, so the receiver is held to what is needed.
  -- The proposer's drops were capped when they were named and are not
  -- re-judged: they are what was offered, and the receiver is accepting it.
  v_need := ff_trade_overflow(v_t.league_id, v_t.receiver_team_id, v_week,
                              coalesce(cardinality(v_gets), 0), coalesce(cardinality(v_gives), 0));
  if cardinality(v_b_drops) > v_need then
    if v_need = 0 then
      raise exception 'your roster has room for this — nobody needs dropping';
    end if;
    raise exception 'this only needs % dropped, not %', v_need, cardinality(v_b_drops);
  end if;

  insert into trade_drops (trade_id, team_id, player_id, seq)
  select p_trade_id, v_t.receiver_team_id, pid, 100 + i
    from unnest(v_b_drops) with ordinality as g(pid, i);

  insert into transactions (league_id, kind, week, actor_id, note)
  values (v_t.league_id, 'trade', v_week, v_uid, 'trade accepted')
  returning id into v_txn;

  insert into transaction_items (transaction_id, player_id, from_team_id, to_team_id, seq)
  select v_txn, i.player_id, i.from_team_id, i.to_team_id, i.seq
    from trade_items i where i.trade_id = p_trade_id;
  -- A release, in the same entry: to nobody, which is what puts him on waivers.
  insert into transaction_items (transaction_id, player_id, from_team_id, to_team_id, seq)
  select v_txn, d.player_id, d.team_id, null, 200 + d.seq
    from trade_drops d where d.trade_id = p_trade_id;

  perform ff_materialize_roster(v_t.proposer_team_id, v_week);
  perform ff_materialize_roster(v_t.receiver_team_id, v_week);

  update trades set status = 'accepted', responded_at = now(), responded_by = v_uid,
         transaction_id = v_txn, outcome = 'accepted'
   where id = p_trade_id;

  -- Everybody this trade moved — traded or released — is off the block, and
  -- any OTHER live offer naming him, in the deal or among its drops, is now
  -- nonsense. Saying so beats letting the next manager discover it by
  -- pressing accept on something that cannot happen.
  with moved as (
    select player_id from trade_items where trade_id = p_trade_id
    union
    select player_id from trade_drops where trade_id = p_trade_id
  )
  delete from trade_block b using moved m where b.player_id = m.player_id;

  with moved as (
    select player_id from trade_items where trade_id = p_trade_id
    union
    select player_id from trade_drops where trade_id = p_trade_id
  )
  update trades o set status = 'invalid', responded_at = now(),
         outcome = 'a player in this offer was traded elsewhere'
   where o.league_id = v_t.league_id
     and o.status = 'proposed'
     and o.id <> p_trade_id
     and (exists (select 1 from trade_items oi join moved m on m.player_id = oi.player_id
                   where oi.trade_id = o.id)
          or exists (select 1 from trade_drops od join moved m on m.player_id = od.player_id
                      where od.trade_id = o.id));

  select string_agg(p.full_name, ', ' order by i.seq) into v_names
    from trade_items i join players p on p.id = i.player_id where i.trade_id = p_trade_id;
  select string_agg(p.full_name, ', ' order by d.seq) into v_cut
    from trade_drops d join players p on p.id = d.player_id where d.trade_id = p_trade_id;

  insert into activity_events (league_id, event_type, headline, detail, actor_id, source_type, source_id)
  values (v_t.league_id, 'trade',
          left((select name from teams where id = v_t.proposer_team_id) || ' and ' ||
               (select name from teams where id = v_t.receiver_team_id) || ' made a trade', 140),
          left(coalesce(v_names, '') || coalesce(' · released ' || v_cut, ''), 1000),
          v_uid, 'trade', p_trade_id);

  return jsonb_build_object('trade_id', p_trade_id, 'status', 'accepted',
                            'transaction_id', v_txn, 'week', v_week);
end $$;

-- --------------------------------------------------------------- the desk --
-- Restated whole from the live definition; each offer now carries `drops`.
create or replace function public.ff_trade_desk(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid; v_uid uuid := auth.uid(); v_week integer := ff_current_week();
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  if v_uid is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;

  return jsonb_build_object(
    'week', v_week,
    'deadline_week', (select coalesce((settings->>'trade_deadline_week')::int, 99)
                        from leagues where id = v_league),
    'block', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', b.player_id, 'player', p.full_name, 'position', p.position,
               'nfl_team', p.nfl_team, 'team_id', b.team_id, 'team', t.name,
               'note', b.note, 'mine', b.team_id = p_team_id
             ) order by t.name, p.full_name), '[]'::jsonb)
        from trade_block b
        join teams t on t.id = b.team_id
        join players p on p.id = b.player_id
       where t.league_id = v_league
         -- A listed player who has since been dropped, traded or lost on
         -- waivers is an advert for a car you sold. Filtered here rather than
         -- cleaned up on every ownership change, so it is right even if a
         -- cleanup is ever missed.
         and exists (select 1 from ff_owner_at(v_league, v_week) o
                      where o.player_id = b.player_id and o.team_id = b.team_id)),
    'offers', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
      from (
        select tr.id, tr.status, tr.message, tr.created_at, tr.outcome,
               tr.counters_id,
               -- Carried explicitly. The sheet used to infer the counterparty
               -- from the first arriving player, which is nobody at all when
               -- the offer asks for a player and gives none.
               tr.proposer_team_id, tr.receiver_team_id,
               tr.proposer_team_id = p_team_id as mine,
               (select name from teams where id = tr.proposer_team_id) as from_team,
               (select name from teams where id = tr.receiver_team_id) as to_team,
               (select coalesce(jsonb_agg(jsonb_build_object(
                         'player_id', i.player_id, 'player', p.full_name,
                         'position', p.position, 'nfl_team', p.nfl_team,
                         'leaving', i.from_team_id = p_team_id
                       ) order by i.seq), '[]'::jsonb)
                  from trade_items i join players p on p.id = i.player_id
                 where i.trade_id = tr.id) as items,
               (select coalesce(jsonb_agg(jsonb_build_object(
                         'player_id', d.player_id, 'player', p.full_name,
                         'position', p.position, 'nfl_team', p.nfl_team,
                         'team_id', d.team_id, 'mine', d.team_id = p_team_id
                       ) order by d.seq), '[]'::jsonb)
                  from trade_drops d join players p on p.id = d.player_id
                 where d.trade_id = tr.id) as drops
          from trades tr
         where tr.league_id = v_league
           and (tr.proposer_team_id = p_team_id or tr.receiver_team_id = p_team_id)
         order by tr.created_at desc limit 40
      ) x),
    'settled', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trade_id', tr.id, 'when', tr.responded_at,
               'from_team', (select name from teams where id = tr.proposer_team_id),
               'to_team', (select name from teams where id = tr.receiver_team_id)
             ) order by tr.responded_at desc), '[]'::jsonb)
        from (select * from trades where league_id = v_league and status = 'accepted'
               order by responded_at desc limit 10) tr)
  );
end $$;

-- -------------------------------------------------------------- the grants --
-- A Supabase project grants EXECUTE to `authenticated` on every new function
-- by default (see supabase/tests/grants.sql), so the internals are revoked
-- from it explicitly, not just from public and anon.
revoke execute on function public.ff_validate_trade(uuid, uuid, uuid, uuid[], uuid[], integer, uuid[], uuid[])
  from public, anon, authenticated;
revoke execute on function public.ff_trade_overflow(uuid, uuid, integer, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.ff_propose_trade(uuid, uuid, uuid[], uuid[], text, uuid, uuid[]) from public, anon;
revoke execute on function public.ff_respond_trade(uuid, text, uuid[])                           from public, anon;
revoke execute on function public.ff_trade_desk(uuid)                                            from public, anon;

grant execute on function public.ff_propose_trade(uuid, uuid, uuid[], uuid[], text, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.ff_respond_trade(uuid, text, uuid[])                           to authenticated, service_role;
grant execute on function public.ff_trade_desk(uuid)                                            to authenticated, service_role;

-- So an open desk hears an offer's drops arrive, like its items.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and tablename = 'trade_drops') then
    alter publication supabase_realtime add table public.trade_drops;
  end if;
end $$;
