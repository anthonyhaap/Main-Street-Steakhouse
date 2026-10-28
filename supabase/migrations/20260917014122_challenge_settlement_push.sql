-- ============================================================================
-- A bet comes to you.
--
-- The challenge desk worked, and nobody used it, because everything on it
-- happened while nobody was looking: the cron decided a bet at four in the
-- morning on a Tuesday, and the loser found out a week later when somebody
-- brought it up at the bar. Venmo has no way for this app to move the money
-- itself — there is no API for one person to pay another on their behalf, and
-- the README says why we would not hold the stakes even if there were — so the
-- most the house can do is what a good bookie does: tell you the moment it is
-- decided, and hand you the slip.
--
-- Three things here, in the order they matter:
--
--   1. A trigger that tells the right manager at every step — proposed,
--      accepted, decided, paid, confirmed, disputed, voided — through the same
--      outbox trades and waivers use. The tap lands on the card, where the
--      browser has already written the Venmo link with the amount in it.
--   2. The resolver now decides a bet when the standings decide the week:
--      ff_week_final, not its own six-hour guess, and never on a week nobody
--      has scored — an unscored 0–0 was a "tie" that voided a real bet.
--   3. A reminder once the week's grace has run out, filed in its own table so
--      the challenge row, whose terms are immutable by trigger, is not touched.
-- ============================================================================

-- ------------------------------------------------------------ the words --

-- "$20", or "$12.50" when the cents matter. Null in, null out.
create or replace function public.ff_stake_text(p_cents integer)
returns text
language sql
immutable
as $$
  select case when p_cents is null then null
              when p_cents % 100 = 0 then '$' || (p_cents / 100)::text
              else '$' || to_char(p_cents / 100.0, 'FM999990.00') end
$$;

-- A manager's first name, as the recap writes it; the seat's name if the
-- commissioner never typed one. A co-owner is a person too: their own first
-- name from the profile the settlement handle was saved with, and the seat's
-- name when there is none. "Somebody" only for a user with no seat here.
create or replace function public.ff_challenge_who(p_league_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.ff_who(t.manager_name, t.name)
       from teams t
      where t.league_id = p_league_id and t.owner_id = p_user_id
      order by t.created_at limit 1),
    (select public.ff_who(p.display_name, t.name)
       from team_co_owners co
       join teams t on t.id = co.team_id
       left join profiles p on p.id = co.user_id
      where co.league_id = p_league_id and co.user_id = p_user_id
      limit 1),
    'Somebody')
$$;

-- ---------------------------------------------------------- the occasions --

create or replace function public.ff_on_challenge_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url        text := '/challenges#' || new.id;
  v_challenger text;
  v_opponent   text;
  v_winner     text;
  v_loser      text;
  v_loser_id   uuid;
  v_other_id   uuid;
  v_amount     text := ff_stake_text(new.stake_amount_cents);
  v_what       text;
  v_commish    uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;

  v_challenger := ff_challenge_who(new.league_id, new.challenger_id);
  v_opponent   := ff_challenge_who(new.league_id, new.opponent_id);
  -- What the bet is about: the week, for a matchup bet; the title otherwise.
  v_what := coalesce((select 'Week ' || m.week from matchups m where m.id = new.matchup_id), new.title);

  if tg_op = 'INSERT' then
    if new.status = 'proposed' then
      perform ff_notify(new.opponent_id, 'challenge',
        v_challenger || ' challenged you',
        coalesce(v_amount || ' on ', '') || v_what || '. Tap to accept or decline.', v_url);
    end if;
    return null;
  end if;

  if new.winner_id is not null then
    v_loser_id := case when new.winner_id = new.challenger_id then new.opponent_id else new.challenger_id end;
    v_winner   := ff_challenge_who(new.league_id, new.winner_id);
    v_loser    := ff_challenge_who(new.league_id, v_loser_id);
  end if;

  case new.status
    when 'accepted' then
      perform ff_notify(new.challenger_id, 'challenge',
        v_opponent || ' accepted',
        'It''s locked: ' || v_what || coalesce(' for ' || v_amount, '') || '.', v_url);

    when 'declined' then
      perform ff_notify(new.challenger_id, 'challenge',
        v_opponent || ' passed', 'No bet on ' || v_what || '.', v_url);

    -- Decided, with money on it. The resolver writes 'settled' straight away
    -- when there is nothing to pay, so 'resolved' always means a slip is owed.
    when 'resolved' then
      if v_loser_id is not null and v_amount is not null then
        perform ff_notify(v_loser_id, 'challenge',
          'You owe ' || v_winner || ' ' || v_amount,
          v_what || ' went ' || v_winner || '''s way. Tap to pay.', v_url);
        perform ff_notify(new.winner_id, 'challenge',
          v_loser || ' owes you ' || v_amount,
          v_what || ' went your way. Tap to send the request.', v_url);
      end if;

    when 'payment_pending' then
      perform ff_notify(new.winner_id, 'challenge',
        v_loser || ' marked ' || v_amount || ' paid', 'Tap to confirm it arrived.', v_url);

    when 'settled' then
      if old.status = 'payment_pending' then
        perform ff_notify(v_loser_id, 'challenge',
          v_winner || ' confirmed. Settled.',
          v_amount || ' on ' || v_what || ' is squared away.', v_url);
      elsif v_loser_id is not null then
        -- Bragging rights, decided; or a ruling that closed the book outright.
        perform ff_notify(new.winner_id, 'challenge',
          'You won the bet with ' || v_loser, v_what || ' went your way.', v_url);
        perform ff_notify(v_loser_id, 'challenge',
          'You lost the bet with ' || v_winner, v_what || ' went ' || v_winner || '''s way.', v_url);
      end if;

    when 'disputed' then
      select commissioner_id into v_commish from leagues where id = new.league_id;
      perform ff_notify(v_commish, 'challenge',
        'Review requested',
        v_challenger || ' vs ' || v_opponent || ': ' || left(coalesce(new.dispute_reason, ''), 200), v_url);
      -- And the manager on the other side of it, who is otherwise waiting on a
      -- confirmation that is not coming.
      v_other_id := case when auth.uid() = new.challenger_id then new.opponent_id
                         when auth.uid() = new.opponent_id   then new.challenger_id end;
      perform ff_notify(v_other_id, 'challenge',
        'The bet is under review',
        ff_challenge_who(new.league_id, auth.uid()) || ' asked the commissioner to look at ' || v_what || '.', v_url);

    when 'voided' then
      perform ff_notify(new.challenger_id, 'challenge',
        v_what || ' was a tie. Bet''s off.', 'Nothing is owed either way.', v_url);
      perform ff_notify(new.opponent_id, 'challenge',
        v_what || ' was a tie. Bet''s off.', 'Nothing is owed either way.', v_url);

    else null;
  end case;

  return null;
end $$;

drop trigger if exists challenges_notify on public.challenges;
create trigger challenges_notify
  after insert or update of status on public.challenges
  for each row execute function public.ff_on_challenge_changed();

-- ------------------------------------------------------------ the guard --
-- Restated so that an update which leaves the status where it is — the
-- reminder below does not need one, but the next thing will — is not refused
-- as an "invalid transition" from a status to itself. The terms stay immutable.

create or replace function public.ff_guard_challenge_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.title <> old.title or new.terms <> old.terms or new.stake_label <> old.stake_label
     or new.proposition_type <> old.proposition_type or new.challenger_id <> old.challenger_id
     or new.opponent_id <> old.opponent_id or new.league_id <> old.league_id
     or new.stake_amount_cents is distinct from old.stake_amount_cents
     or new.matchup_id is distinct from old.matchup_id then
    raise exception 'challenge terms cannot change after proposal';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'proposed' and new.status not in ('accepted','declined','expired') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'accepted' and new.status not in ('resolved','settled','voided') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'resolved' and new.status not in ('payment_pending','disputed','settled','voided') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'payment_pending' and new.status not in ('settled','disputed') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'disputed' and new.status not in ('resolved','settled','voided') then
      raise exception 'invalid challenge transition';
    elsif old.status in ('declined','expired','settled','voided') then
      raise exception 'challenge is final';
    end if;
  end if;
  if new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
    new.locked_at := coalesce(new.locked_at, now());
  end if;
  new.updated_at := now();
  return new;
end $$;

-- --------------------------------------------------------- the resolver --
-- The same body as 20260827033240 but for the week test: the standings' own
-- ff_week_final in place of a private six-hour margin, and points on the
-- board, so a week that was never scored is not a tie.

create or replace function public.ff_resolve_matchup_challenges()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with ready as (
    select c.id, m.home_points, m.away_points, h.owner_id home_owner, a.owner_id away_owner
      from public.challenges c
      join public.matchups m on m.id = c.matchup_id
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
      join public.leagues l on l.id = c.league_id
     where c.status = 'accepted' and c.proposition_type = 'weekly_matchup_winner'
       and m.home_points + m.away_points > 0
       and public.ff_week_final(l.season, m.week)
  )
  update public.challenges c
     set status = case when r.home_points = r.away_points then 'voided'
                       when c.stake_amount_cents is null then 'settled'
                       else 'resolved' end,
         winner_id = case when r.home_points > r.away_points then r.home_owner
                          when r.away_points > r.home_points then r.away_owner end,
         resolved_at = now(),
         settlement_due_at = case when c.stake_amount_cents is null or r.home_points = r.away_points
                                  then null else now() + interval '7 days' end,
         resolution_evidence = jsonb_build_object('source', 'official_matchup',
                                 'home_points', r.home_points, 'away_points', r.away_points)
    from ready r where c.id = r.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- --------------------------------------------------------- the reminder --

create table if not exists public.challenge_reminders (
  challenge_id uuid primary key references public.challenges(id) on delete cascade,
  sent_at      timestamptz not null default now()
);
alter table public.challenge_reminders enable row level security;
revoke all on table public.challenge_reminders from public, anon, authenticated;

comment on table public.challenge_reminders is
  'One row per challenge nudged after its settlement grace ran out. Its own table so the immutable challenge row is not written to.';

-- Once, when a week's grace has run out on a slip still open: the loser if
-- nothing has been marked paid, the winner if a payment is waiting on their
-- word. Daily, so a bet decided on any day is chased the day after its week.
create or replace function public.ff_remind_overdue_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer := 0; v_c record; v_loser_id uuid; v_winner text; v_loser text; v_amount text; v_url text;
begin
  for v_c in
    select c.* from challenges c
     where c.status in ('resolved','payment_pending')
       and c.stake_amount_cents is not null and c.winner_id is not null
       and c.settlement_due_at < now()
       and not exists (select 1 from challenge_reminders r where r.challenge_id = c.id)
     order by c.settlement_due_at
  loop
    v_loser_id := case when v_c.winner_id = v_c.challenger_id then v_c.opponent_id else v_c.challenger_id end;
    v_winner   := ff_challenge_who(v_c.league_id, v_c.winner_id);
    v_loser    := ff_challenge_who(v_c.league_id, v_loser_id);
    v_amount   := ff_stake_text(v_c.stake_amount_cents);
    v_url      := '/challenges#' || v_c.id;

    if v_c.status = 'resolved' then
      perform ff_notify(v_loser_id, 'challenge',
        'Still owed: ' || v_amount || ' to ' || v_winner,
        'A week has gone by. Tap to pay.', v_url);
    else
      perform ff_notify(v_c.winner_id, 'challenge',
        v_loser || ' paid a week ago',
        'Confirm it arrived, or ask for a review.', v_url);
    end if;

    insert into challenge_reminders (challenge_id) values (v_c.id) on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'challenge-reminders';
select cron.schedule('challenge-reminders', '0 14 * * *', 'select public.ff_remind_overdue_challenges()');

-- ------------------------------------------------------------- the grants --
revoke execute on function public.ff_stake_text(integer)                   from public, anon;
revoke execute on function public.ff_challenge_who(uuid,uuid)              from public, anon, authenticated;
revoke execute on function public.ff_on_challenge_changed()                from public, anon, authenticated;
revoke execute on function public.ff_guard_challenge_update()              from public, anon;
revoke execute on function public.ff_resolve_matchup_challenges()          from public, anon, authenticated;
revoke execute on function public.ff_remind_overdue_challenges()           from public, anon, authenticated;

grant execute on function public.ff_stake_text(integer)                    to authenticated, service_role;
grant execute on function public.ff_guard_challenge_update()               to authenticated;
grant execute on function public.ff_challenge_who(uuid,uuid)               to service_role;
grant execute on function public.ff_resolve_matchup_challenges()           to service_role;
grant execute on function public.ff_remind_overdue_challenges()            to service_role;
