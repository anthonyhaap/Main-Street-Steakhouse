-- ============================================================================
-- Trades: an offer, a counter, and a block to advertise on.
--
-- The transaction log already knew how to say this. `transaction_items` carries
-- a from-team AND a to-team on every row, which add/drop and waivers only ever
-- used one half of; a trade is the case both halves were designed for. So an
-- executed trade is one `kind = 'trade'` header with an item per player, and
-- `ff_owner_at` needs no changes — the last word about a player is now
-- sometimes "he went that way".
--
-- What is new is the negotiation, which is not a transaction at all until
-- somebody says yes. `trades` is the offer on the table; nothing in the log
-- exists until it is accepted, and a declined trade leaves no trace on any
-- roster.
--
-- The deadline is the league's own: `settings.trade_deadline_week` has said 12
-- since the league was configured.
-- ============================================================================

-- --------------------------------------------------------------- the block --

-- Players their manager will listen to offers on. Not a commitment and not an
-- auction — a notice board, so a manager with a surplus at running back does
-- not have to message eleven people to find out who needs one.
create table if not exists public.trade_block (
  team_id   uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  note      text check (note is null or char_length(note) <= 140),
  listed_at timestamptz not null default now(),
  primary key (team_id, player_id)
);
create index if not exists trade_block_player_idx on public.trade_block (player_id);

comment on table public.trade_block is
  'Players their manager is open to moving. Visible to the whole league; listing one promises nothing.';

-- --------------------------------------------------------------- the offer --

create table if not exists public.trades (
  id               uuid primary key default gen_random_uuid(),
  league_id        uuid not null references public.leagues(id) on delete cascade,
  proposer_team_id uuid not null references public.teams(id) on delete cascade,
  receiver_team_id uuid not null references public.teams(id) on delete cascade,
  status           text not null default 'proposed'
                   check (status in ('proposed','accepted','declined','cancelled',
                                     'countered','invalid')),
  week             integer not null check (week between 1 and 25),
  message          text check (message is null or char_length(message) <= 500),
  -- A counter is a new offer that closes the one it answers, and keeps the
  -- thread readable: "Dave countered" is the same conversation, not a new one.
  counters_id      uuid references public.trades(id) on delete set null,
  outcome          text check (outcome is null or char_length(outcome) <= 200),
  transaction_id   uuid references public.transactions(id) on delete set null,
  proposed_by      uuid references auth.users(id) on delete set null,
  responded_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  constraint trades_two_teams check (proposer_team_id <> receiver_team_id)
);
create index if not exists trades_league_idx on public.trades (league_id, status, created_at desc);
create index if not exists trades_teams_idx  on public.trades (proposer_team_id, receiver_team_id);

create table if not exists public.trade_items (
  id           uuid primary key default gen_random_uuid(),
  trade_id     uuid not null references public.trades(id) on delete cascade,
  player_id    uuid not null references public.players(id),
  from_team_id uuid not null references public.teams(id) on delete cascade,
  to_team_id   uuid not null references public.teams(id) on delete cascade,
  seq          integer not null default 0,
  constraint trade_items_moves check (from_team_id <> to_team_id)
);
create index if not exists trade_items_trade_idx on public.trade_items (trade_id, seq);
-- One player appears once in an offer. Naming him on both sides is not a trade.
create unique index if not exists trade_items_one_each
  on public.trade_items (trade_id, player_id);

alter table public.trade_block enable row level security;
alter table public.trades      enable row level security;
alter table public.trade_items enable row level security;

-- The block is public to the league — advertising it is the point.
drop policy if exists trade_block_read on public.trade_block;
create policy trade_block_read on public.trade_block
  for select to authenticated using (public.ff_is_member());

-- An offer is between two managers. The league sees it once it is settled;
-- before that only the two of them do. A trade everyone can read while it is
-- live is a trade everyone can lobby about, and the point of the trade block
-- is that the negotiating happens where the two parties choose.
drop policy if exists trades_read on public.trades;
create policy trades_read on public.trades
  for select to authenticated using (
    public.ff_is_member() and (
      status not in ('proposed')
      or public.ff_owns_team(proposer_team_id)
      or public.ff_owns_team(receiver_team_id)
    )
  );

-- The items follow the offer. Spelled out rather than leaning on the parent
-- table's policy applying inside this subquery — it does, but a reader should
-- not have to know that to see who can read a live offer's contents.
drop policy if exists trade_items_read on public.trade_items;
create policy trade_items_read on public.trade_items
  for select to authenticated using (
    public.ff_is_member() and exists (
      select 1 from public.trades t
       where t.id = trade_id
         and (t.status not in ('proposed')
              or public.ff_owns_team(t.proposer_team_id)
              or public.ff_owns_team(t.receiver_team_id))
    )
  );

revoke all on table public.trade_block, public.trades, public.trade_items from public, anon;
grant select on table public.trade_block, public.trades, public.trade_items to authenticated;

-- ------------------------------------------------------- listing a player --

create or replace function public.ff_set_trade_block(
  p_team_id    uuid,
  p_player_ids uuid[],
  p_note       text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_league uuid; v_uid uuid := auth.uid(); v_n integer;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;
  if v_uid is not null and not ff_owns_team(p_team_id) then
    raise exception 'that is not your team';
  end if;

  -- Only players actually owned, checked now rather than trusted: a block that
  -- lists a player somebody else owns is an advert for a car you sold.
  if exists (
    select 1 from unnest(p_player_ids) pid
     where pid not in (select o.player_id from ff_owner_at(v_league, ff_current_week()) o
                        where o.team_id = p_team_id)
  ) then
    raise exception 'you can only list players you own';
  end if;

  delete from trade_block where team_id = p_team_id
     and player_id <> all (coalesce(p_player_ids, '{}'::uuid[]));

  insert into trade_block (team_id, player_id, note)
  select p_team_id, pid, p_note from unnest(coalesce(p_player_ids, '{}'::uuid[])) pid
  on conflict (team_id, player_id) do update set note = excluded.note;

  select count(*) into v_n from trade_block where team_id = p_team_id;
  return v_n;
end $$;

-- ------------------------------------------------------ proposing an offer --

-- Everything a trade must be true about is checked here AND again on accept.
-- Twice is not belt and braces: an offer sits on the table for days, and a
-- roster does not. What was legal on Sunday can be nonsense by Wednesday.
create or replace function public.ff_validate_trade(
  p_league_id uuid,
  p_a_team    uuid,
  p_b_team    uuid,
  p_a_gives   uuid[],
  p_b_gives   uuid[],
  p_week      integer
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

  -- A man whose game has started belongs to this week's scoreboard, not to a
  -- negotiation. Same rule ff_add_drop applies, for the same reason.
  foreach v_pid in array (coalesce(p_a_gives, '{}'::uuid[]) || coalesce(p_b_gives, '{}'::uuid[])) loop
    v_lock := ff_lock_time(v_pid, p_week);
    if v_lock is not null and v_lock <= now() then
      raise exception '%''s game has already kicked off',
        (select full_name from players where id = v_pid);
    end if;
  end loop;

  -- Uneven trades are fine; over-full rosters are not.
  select count(*) into v_a_size from ff_owner_at(p_league_id, p_week) o where o.team_id = p_a_team;
  select count(*) into v_b_size from ff_owner_at(p_league_id, p_week) o where o.team_id = p_b_team;
  v_a_size := v_a_size - coalesce(array_length(p_a_gives, 1), 0) + coalesce(array_length(p_b_gives, 1), 0);
  v_b_size := v_b_size - coalesce(array_length(p_b_gives, 1), 0) + coalesce(array_length(p_a_gives, 1), 0);

  if v_limit is not null and v_a_size > v_limit then
    raise exception 'that would leave the proposing roster at %, over the % man limit', v_a_size, v_limit;
  end if;
  if v_limit is not null and v_b_size > v_limit then
    raise exception 'that would leave the other roster at %, over the % man limit', v_b_size, v_limit;
  end if;
end $$;

-- Put an offer on the table. `p_counters_id` closes the offer being answered
-- and links the two, so a negotiation reads as one thread.
create or replace function public.ff_propose_trade(
  p_from_team_id uuid,
  p_to_team_id   uuid,
  p_i_give       uuid[] default '{}',
  p_i_get        uuid[] default '{}',
  p_message      text default null,
  p_counters_id  uuid default null
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
  perform ff_validate_trade(v_league, p_from_team_id, p_to_team_id, p_i_give, p_i_get, v_week);

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

  insert into activity_events (league_id, event_type, headline, detail, actor_id, source_type, source_id)
  values (v_league, 'trade',
          left((select name from teams where id = p_from_team_id) ||
               case when p_counters_id is not null then ' countered ' else ' offered ' end ||
               (select name from teams where id = p_to_team_id) || ' a trade', 140),
          'Week ' || v_week, v_uid, 'trade', v_id);

  return jsonb_build_object('trade_id', v_id, 'week', v_week,
                            'counters', p_counters_id, 'status', 'proposed');
end $$;

-- ------------------------------------------------------ answering an offer --

-- Accept, decline, or withdraw. Accepting is the only one that touches a
-- roster, and it re-validates first: an offer that was legal when it was made
-- may have been overtaken by a waiver claim, a drop, or a kickoff.
create or replace function public.ff_respond_trade(p_trade_id uuid, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_t     record;
  v_gives uuid[];
  v_gets  uuid[];
  v_txn   uuid;
  v_week  integer;
  v_names text;
begin
  if p_response not in ('accepted','declined','cancelled') then
    raise exception 'a trade is accepted, declined or cancelled';
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

  -- The week is today's, not the week the offer was made in: a trade agreed on
  -- Tuesday takes effect now, and the deadline applies to when it lands.
  perform ff_validate_trade(v_t.league_id, v_t.proposer_team_id, v_t.receiver_team_id,
                            coalesce(v_gives, '{}'), coalesce(v_gets, '{}'), v_week);

  insert into transactions (league_id, kind, week, actor_id, note)
  values (v_t.league_id, 'trade', v_week, v_uid, 'trade accepted')
  returning id into v_txn;

  insert into transaction_items (transaction_id, player_id, from_team_id, to_team_id, seq)
  select v_txn, i.player_id, i.from_team_id, i.to_team_id, i.seq
    from trade_items i where i.trade_id = p_trade_id;

  perform ff_materialize_roster(v_t.proposer_team_id, v_week);
  perform ff_materialize_roster(v_t.receiver_team_id, v_week);

  update trades set status = 'accepted', responded_at = now(), responded_by = v_uid,
         transaction_id = v_txn, outcome = 'accepted'
   where id = p_trade_id;

  -- A traded player is off the block, and any OTHER live offer naming him is
  -- now nonsense. Saying so beats letting the next manager discover it by
  -- pressing accept on something that cannot happen.
  delete from trade_block b
   using trade_items i
   where i.trade_id = p_trade_id and b.player_id = i.player_id;

  update trades o set status = 'invalid', responded_at = now(),
         outcome = 'a player in this offer was traded elsewhere'
   where o.league_id = v_t.league_id
     and o.status = 'proposed'
     and o.id <> p_trade_id
     and exists (select 1 from trade_items oi
                  join trade_items ti on ti.player_id = oi.player_id and ti.trade_id = p_trade_id
                 where oi.trade_id = o.id);

  select string_agg(p.full_name, ', ' order by i.seq) into v_names
    from trade_items i join players p on p.id = i.player_id where i.trade_id = p_trade_id;

  insert into activity_events (league_id, event_type, headline, detail, actor_id, source_type, source_id)
  values (v_t.league_id, 'trade',
          left((select name from teams where id = v_t.proposer_team_id) || ' and ' ||
               (select name from teams where id = v_t.receiver_team_id) || ' made a trade', 140),
          left(coalesce(v_names, ''), 1000), v_uid, 'trade', p_trade_id);

  return jsonb_build_object('trade_id', p_trade_id, 'status', 'accepted',
                            'transaction_id', v_txn, 'week', v_week);
end $$;

-- ---------------------------------------------------------------- the desk --

-- One call for the trade screen: the league's block, this team's live offers
-- in both directions, and what has already been done.
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
       where t.league_id = v_league),
    'offers', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
      from (
        select tr.id, tr.status, tr.message, tr.created_at, tr.outcome,
               tr.counters_id,
               tr.proposer_team_id = p_team_id as mine,
               (select name from teams where id = tr.proposer_team_id) as from_team,
               (select name from teams where id = tr.receiver_team_id) as to_team,
               (select coalesce(jsonb_agg(jsonb_build_object(
                         'player_id', i.player_id, 'player', p.full_name,
                         'position', p.position, 'nfl_team', p.nfl_team,
                         'leaving', i.from_team_id = p_team_id
                       ) order by i.seq), '[]'::jsonb)
                  from trade_items i join players p on p.id = i.player_id
                 where i.trade_id = tr.id) as items
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

-- ------------------------------------------------------------- the grants --
revoke execute on function public.ff_validate_trade(uuid,uuid,uuid,uuid[],uuid[],integer) from public, anon;
revoke execute on function public.ff_set_trade_block(uuid,uuid[],text)                     from public, anon;
revoke execute on function public.ff_propose_trade(uuid,uuid,uuid[],uuid[],text,uuid)      from public, anon;
revoke execute on function public.ff_respond_trade(uuid,text)                              from public, anon;
revoke execute on function public.ff_trade_desk(uuid)                                      from public, anon;

grant execute on function public.ff_set_trade_block(uuid,uuid[],text)                to authenticated, service_role;
grant execute on function public.ff_propose_trade(uuid,uuid,uuid[],uuid[],text,uuid) to authenticated, service_role;
grant execute on function public.ff_respond_trade(uuid,text)                         to authenticated, service_role;
grant execute on function public.ff_trade_desk(uuid)                                 to authenticated, service_role;
grant execute on function public.ff_validate_trade(uuid,uuid,uuid,uuid[],uuid[],integer) to service_role;
