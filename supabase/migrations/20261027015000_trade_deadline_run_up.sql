-- ============================================================================
-- The trade deadline, felt before it arrives.
--
-- Until now the deadline was a number: `settings.trade_deadline_week`, printed
-- on the desk as "deadline: week 12", enforced by ff_validate_trade refusing
-- once ff_current_week() passes it. Nobody was told it was coming, an offer
-- left on the table when it shut just sat there as "proposed" forever, and the
-- moment itself happened silently in the small hours of a Tuesday.
--
-- The moment is exact, and this names it. ff_current_week() moves on four
-- hours after the week's last kickoff, so trades close at
-- `last_kick + 4 hours` of the deadline week — the same instant the validator
-- starts refusing, computed from the same view, so the countdown and the rule
-- cannot disagree.
--
-- Three things happen around it, once each per league per deadline:
--
--   week    seven days out (the deadline week begins): a pinned house line on
--           the League Feed, a 'deadline' activity event, and a push to every
--           manager — with how much is on the table and on the block.
--   day     the last 24 hours: a push to every manager, naming the offers
--           waiting on them.
--   closed  at the deadline: every offer still proposed expires (status
--           'invalid', outcome saying why), the pinned line comes down, the
--           house says the market is shut, and each side of an expired offer
--           is told.
--
-- Bookkeeping is one row per (league, deadline instant, stage), so re-running
-- the job is a no-op, and a commissioner who moves the deadline gets a fresh
-- run-up for the new one. Each stage has a window — a job that first runs
-- inside the last day skips the week post rather than sending both at once,
-- and nothing is announced for a deadline more than two days gone.
--
-- Pushes go through ff_notify as kind 'trade', so the trades switch on My
-- Team silences them like any other trade alert.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

-- ------------------------------------------------------------ the instant --

create or replace function public.ff_trade_deadline_at(p_league_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select w.last_kick + interval '4 hours'
    from leagues l
    join nfl_weeks w
      on w.season_type = 2
     and w.week = coalesce((l.settings->>'trade_deadline_week')::int, 99)
   where l.id = p_league_id
$$;

comment on function public.ff_trade_deadline_at(uuid) is
  'When trades close: four hours after the deadline week''s last kickoff — the instant ff_current_week() moves past it and ff_validate_trade starts refusing. Null when the deadline week has no games on the schedule.';

-- ------------------------------------------------------- the run-up, read --

-- One call for the front page and the desk: when it closes, and how much is
-- in play. `waiting` is the offers sent to p_team_id, and only for a caller
-- who sits at that team.
create or replace function public.ff_trade_deadline(p_league_id uuid, p_team_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_week     integer := ff_current_week();
  v_deadline integer;
begin
  if auth.uid() is not null and not ff_is_member(p_league_id) then
    raise exception 'not a member of this league';
  end if;

  select coalesce((settings->>'trade_deadline_week')::int, 99) into v_deadline
    from leagues where id = p_league_id;
  if v_deadline is null then raise exception 'league not found'; end if;

  return jsonb_build_object(
    'week', v_week,
    'deadline_week', v_deadline,
    'closes_at', ff_trade_deadline_at(p_league_id),
    'open', v_week <= v_deadline,
    'offers', (select count(*) from trades where league_id = p_league_id and status = 'proposed'),
    'trades', (select count(*) from trades where league_id = p_league_id and status = 'accepted'),
    'block', (
      select count(*) from trade_block b
        join teams t on t.id = b.team_id
       where t.league_id = p_league_id
         and exists (select 1 from ff_owner_at(p_league_id, v_week) o
                      where o.player_id = b.player_id and o.team_id = b.team_id)),
    'waiting', case
      when p_team_id is not null and ff_owns_team(p_team_id) then
        (select count(*) from trades
          where league_id = p_league_id and status = 'proposed' and receiver_team_id = p_team_id)
      end
  );
end $$;

-- ---------------------------------------------------------- bookkeeping --

create table if not exists public.trade_deadline_posts (
  league_id  uuid not null references public.leagues(id) on delete cascade,
  closes_at  timestamptz not null,
  stage      text not null check (stage in ('week', 'day', 'closed')),
  message_id uuid references public.league_messages(id) on delete set null,
  posted_at  timestamptz not null default now(),
  primary key (league_id, closes_at, stage)
);

comment on table public.trade_deadline_posts is
  'One row per league per deadline instant per stage of the run-up, so ff_trade_deadline_tick never announces the same thing twice.';

revoke all on table public.trade_deadline_posts from public, anon, authenticated;

-- ------------------------------------------------------------ the job --

create or replace function public.ff_trade_deadline_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league  leagues%rowtype;
  v_closes  timestamptz;
  v_when    text;
  v_status  text;
  v_offers  integer;
  v_block   integer;
  v_trades  integer;
  v_msg     uuid;
  v_user    uuid;
  v_team    record;
  v_offer   record;
  v_n       integer;
  v_out     jsonb := '[]'::jsonb;
begin
  for v_league in select * from leagues loop
    begin
      v_closes := ff_trade_deadline_at(v_league.id);
      continue when v_closes is null;

      -- No trades before the draft, so nothing to run up to.
      select d.status::text into v_status from drafts d
       where d.league_id = v_league.id order by d.started_at nulls last, d.id limit 1;
      continue when v_status is distinct from 'complete';

      -- "Tue 12:15 AM ET": the league's clock, as clockLabel prints it.
      v_when := to_char(v_closes at time zone 'America/New_York', 'Dy FMHH12:MI AM') || ' ET';

      select count(*) into v_offers from trades where league_id = v_league.id and status = 'proposed';
      select count(*) into v_trades from trades where league_id = v_league.id and status = 'accepted';
      select count(*) into v_block from trade_block b join teams t on t.id = b.team_id
       where t.league_id = v_league.id;

      -- --------------------------------------------------------- week --
      if p_now >= v_closes - interval '7 days' and p_now < v_closes - interval '24 hours'
         and not exists (select 1 from trade_deadline_posts
                          where league_id = v_league.id and closes_at = v_closes and stage = 'week') then
        insert into league_messages (league_id, author_id, kind, body, pinned)
        values (v_league.id, null, 'house',
                '⏳ Trade deadline week. Offers can be made and accepted until ' || v_when
                || ', after Monday night''s game. Anything still on the table then expires.',
                true)
        returning id into v_msg;

        insert into activity_events (league_id, event_type, headline, detail, source_type)
        values (v_league.id, 'deadline', 'Trade deadline week',
                'Trades close ' || v_when || '.', 'trade_deadline');

        for v_user in
          select distinct u from teams t, lateral ff_team_users(t.id) u where t.league_id = v_league.id
        loop
          perform ff_notify(v_user, 'trade', 'Trade deadline week',
            'Trades close ' || v_when || '. '
            || case v_offers when 0 then 'Nothing on the table yet'
                             when 1 then '1 offer on the table'
                             else v_offers || ' offers on the table' end
            || case v_block when 0 then '.'
                            when 1 then ', 1 player on the block.'
                            else ', ' || v_block || ' players on the block.' end,
            '/transactions?tab=trades');
        end loop;

        insert into trade_deadline_posts (league_id, closes_at, stage, message_id)
        values (v_league.id, v_closes, 'week', v_msg);
        v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'stage', 'week'));
      end if;

      -- ---------------------------------------------------------- day --
      if p_now >= v_closes - interval '24 hours' and p_now < v_closes
         and not exists (select 1 from trade_deadline_posts
                          where league_id = v_league.id and closes_at = v_closes and stage = 'day') then
        for v_team in select id from teams where league_id = v_league.id loop
          select count(*) into v_n from trades
           where league_id = v_league.id and status = 'proposed' and receiver_team_id = v_team.id;
          for v_user in select u from ff_team_users(v_team.id) u loop
            perform ff_notify(v_user, 'trade', 'Last day to trade',
              'Trades close ' || v_when || ', after Monday night''s game.'
              || case v_n when 0 then ''
                          when 1 then ' 1 offer is waiting on you.'
                          else ' ' || v_n || ' offers are waiting on you.' end,
              '/transactions?tab=trades');
          end loop;
        end loop;

        insert into trade_deadline_posts (league_id, closes_at, stage)
        values (v_league.id, v_closes, 'day');
        v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'stage', 'day'));
      end if;

      -- ------------------------------------------------------- closed --
      if p_now >= v_closes and p_now < v_closes + interval '2 days'
         and not exists (select 1 from trade_deadline_posts
                          where league_id = v_league.id and closes_at = v_closes and stage = 'closed') then
        -- Each side of an offer the deadline killed is told, before the
        -- status changes and the offer stops being findable as live.
        for v_offer in
          select o.id, o.proposer_team_id, o.receiver_team_id,
                 pt.name as proposer, rt.name as receiver
            from trades o
            join teams pt on pt.id = o.proposer_team_id
            join teams rt on rt.id = o.receiver_team_id
           where o.league_id = v_league.id and o.status = 'proposed'
        loop
          for v_user in select u from ff_team_users(v_offer.proposer_team_id) u loop
            perform ff_notify(v_user, 'trade', 'Your offer expired',
              'The trade deadline passed with your offer to ' || v_offer.receiver || ' unanswered.',
              '/transactions?tab=trades');
          end loop;
          for v_user in select u from ff_team_users(v_offer.receiver_team_id) u loop
            perform ff_notify(v_user, 'trade', 'An offer expired',
              v_offer.proposer || '''s offer to you expired at the trade deadline.',
              '/transactions?tab=trades');
          end loop;
        end loop;

        update trades set status = 'invalid', responded_at = p_now,
               outcome = 'expired at the trade deadline'
         where league_id = v_league.id and status = 'proposed';
        get diagnostics v_n = row_count;

        update league_messages set pinned = false
         where id in (select message_id from trade_deadline_posts
                       where league_id = v_league.id and closes_at = v_closes and stage = 'week')
           and pinned;

        insert into league_messages (league_id, author_id, kind, body, pinned)
        values (v_league.id, null, 'house',
                '🔒 The trade deadline has passed. '
                || case v_trades when 0 then 'No trades this season'
                                 when 1 then '1 trade this season'
                                 else v_trades || ' trades this season' end
                || '. From here, rosters change through waivers and free agency only.',
                false)
        returning id into v_msg;

        insert into activity_events (league_id, event_type, headline, detail, source_type)
        values (v_league.id, 'deadline', 'The trade deadline has passed',
                case when v_n = 0 then null
                     when v_n = 1 then '1 offer still on the table expired.'
                     else v_n || ' offers still on the table expired.' end,
                'trade_deadline');

        insert into trade_deadline_posts (league_id, closes_at, stage, message_id)
        values (v_league.id, v_closes, 'closed', v_msg);
        v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'stage', 'closed', 'expired', v_n));
      end if;
    exception when others then
      -- Swallowed, like the other scheduled posts: one league's bad hour
      -- should not cancel the run-up for the rest.
      v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'error', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ran_at', p_now, 'leagues', v_out);
end;
$fn$;

-- ------------------------------------------------------------- grants --

revoke all on function public.ff_trade_deadline_at(uuid)             from public, anon;
revoke all on function public.ff_trade_deadline(uuid, uuid)          from public, anon;
revoke all on function public.ff_trade_deadline_tick(timestamptz)    from public, anon, authenticated;
grant execute on function public.ff_trade_deadline_at(uuid)          to authenticated, service_role;
grant execute on function public.ff_trade_deadline(uuid, uuid)       to authenticated, service_role;

-- --------------------------------------------------------------- cron --
-- Every fifteen minutes: the deadline lands at a quarter past on a Tuesday
-- morning, and the expiry line should not trail it by an hour.

select cron.schedule('trade-deadline', '*/15 * * * *', 'select public.ff_trade_deadline_tick()');
