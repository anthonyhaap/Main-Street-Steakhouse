-- ============================================================================
-- Two things the League Feed posts to itself: Sunday Live and the Thursday
-- prediction poll.
--
-- Sunday Live is a pinned, house-voiced line opened every Sunday morning and
-- unpinned the following Tuesday — "keep it pinned until Tuesday" is the
-- whole ask, so the schema tracks exactly one open/close pair per league per
-- week rather than trying to infer it from message bodies. The Thursday
-- prediction is a system-authored poll ("who scores the most this week?"),
-- one per league per NFL week, built from the league's own team names so it
-- needs no content nobody has yet — the games haven't been played.
--
-- Both follow ff_post_weekly_recaps's shape (20260904022842): a per-league
-- loop, one row of bookkeeping to make re-running the job a no-op, and a
-- function that swallows its own failures so a bad week for one league does
-- not take the cron run down for the rest. A pinned house post needs `house`
-- added to the pinned-kind check, which until now only ever allowed a
-- commissioner's announcement.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

-- ------------------------------------------------------------- the schema --

alter table public.league_messages drop constraint if exists league_messages_pinned_kind_check;
alter table public.league_messages
  add constraint league_messages_pinned_kind_check check (not pinned or kind in ('announcement', 'house'));

comment on column public.league_messages.pinned is
  'True while this line holds a place on the League Feed''s pinned rail: a commissioner announcement until unpinned, or the weekly Sunday Live post until it closes on Tuesday.';

create table if not exists public.sunday_live_threads (
  league_id  uuid not null references public.leagues(id) on delete cascade,
  -- ISO year-week ('2026-W38'), so the job is idempotent regardless of the
  -- exact minute it runs and survives a Sunday that spans a year boundary.
  iso_week   text not null,
  message_id uuid references public.league_messages(id) on delete set null,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  primary key (league_id, iso_week)
);

comment on table public.sunday_live_threads is
  'One row per league per week the Sunday Live post has been opened, so ff_open_sunday_live and ff_close_sunday_live never double-post or double-close.';

revoke all on table public.sunday_live_threads from public, anon, authenticated;

create table if not exists public.weekly_predictions (
  league_id uuid not null references public.leagues(id) on delete cascade,
  week      integer not null,
  poll_id   uuid references public.polls(id) on delete set null,
  posted_at timestamptz not null default now(),
  primary key (league_id, week)
);

comment on table public.weekly_predictions is
  'One row per league per NFL week the Thursday prediction poll has been posted, so ff_post_weekly_prediction never asks the same question twice.';

revoke all on table public.weekly_predictions from public, anon, authenticated;

-- --------------------------------------------------------------- the jobs --

create or replace function public.ff_open_sunday_live()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league leagues%rowtype;
  v_week   text := to_char(current_date, 'IYYY-"W"IW');
  v_id     uuid;
  v_out    jsonb := '[]'::jsonb;
begin
  for v_league in select * from leagues loop
    if exists (select 1 from sunday_live_threads where league_id = v_league.id and iso_week = v_week) then
      continue;
    end if;

    begin
      insert into league_messages (league_id, author_id, kind, body, pinned)
      values (v_league.id, null, 'house',
              '🏈 Sunday Live — talk trash, react to every touchdown and bad beat. Pinned through Tuesday.',
              true)
      returning id into v_id;

      insert into sunday_live_threads (league_id, iso_week, message_id)
      values (v_league.id, v_week, v_id);

      v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'message_id', v_id));
    exception when others then
      -- Swallowed, like ff_post_weekly_recaps: one league's bad morning
      -- should not cancel Sunday Live for the other eleven.
      v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'error', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ran_at', now(), 'week', v_week, 'leagues', v_out);
end;
$fn$;

create or replace function public.ff_close_sunday_live()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
  v_out jsonb := '[]'::jsonb;
begin
  for v_row in select * from sunday_live_threads where closed_at is null loop
    begin
      update league_messages set pinned = false
       where id = v_row.message_id and pinned = true;

      update sunday_live_threads set closed_at = now()
       where league_id = v_row.league_id and iso_week = v_row.iso_week;

      v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_row.league_id, 'week', v_row.iso_week));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_row.league_id, 'error', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ran_at', now(), 'closed', v_out);
end;
$fn$;

create or replace function public.ff_post_weekly_prediction()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league  leagues%rowtype;
  v_week    integer := public.ff_current_week();
  v_poll    uuid;
  v_out     jsonb := '[]'::jsonb;
  v_n       integer;
begin
  if v_week is null then
    return jsonb_build_object('ran_at', now(), 'posted', false, 'reason', 'no current week');
  end if;

  for v_league in select * from leagues loop
    if exists (select 1 from weekly_predictions where league_id = v_league.id and week = v_week) then
      continue;
    end if;

    begin
      select count(*) into v_n from teams where league_id = v_league.id;
      if v_n < 2 then
        raise exception 'fewer than two teams';
      end if;

      insert into polls (league_id, author_id, question)
      values (v_league.id, null, 'Who scores the most this week?')
      returning id into v_poll;

      insert into poll_options (poll_id, label, seq)
      select v_poll, t.name, row_number() over (order by t.name)
        from teams t where t.league_id = v_league.id;

      insert into weekly_predictions (league_id, week, poll_id)
      values (v_league.id, v_week, v_poll);

      v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'poll_id', v_poll));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id, 'error', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ran_at', now(), 'week', v_week, 'leagues', v_out);
end;
$fn$;

-- Service-only: pg_cron calls these directly, the same as ff_post_weekly_recaps.
revoke all on function public.ff_open_sunday_live()       from public, anon, authenticated;
revoke all on function public.ff_close_sunday_live()       from public, anon, authenticated;
revoke all on function public.ff_post_weekly_prediction()  from public, anon, authenticated;

-- ------------------------------------------------------------------- cron --
-- Sunday morning, before the early games, so the thread is open before there
-- is anything to react to. Tuesday morning close gives the whole "Manic
-- Monday" window before the rail clears. Thursday matches weekly-recap's own
-- hour (13:00 UTC, 9am ET) for the same reason that one picked it.

select cron.schedule('open-sunday-live',   '0 15 * * 0', 'select public.ff_open_sunday_live()');
select cron.schedule('close-sunday-live',  '0 13 * * 2', 'select public.ff_close_sunday_live()');
select cron.schedule('weekly-predictions', '0 13 * * 4', 'select public.ff_post_weekly_prediction()');
