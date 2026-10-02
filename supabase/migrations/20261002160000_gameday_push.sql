-- ============================================================================
-- Game day, on the lock screen.
--
-- Push was built for the things a manager cannot look up in time: an offer
-- arriving, a claim settling, a bet decided, his name in the chat. A Sunday
-- is the other thing. The game center tells you what every play meant to
-- your matchup — but only while you are looking at it, and on a Sunday you
-- are looking at the television.
--
-- So `sunday_events` — the server's record of what happened, written once per
-- thing by the detector — now also writes to the outbox, for the managers it
-- happened to. Two new kinds, with their own switches:
--
--   gameday   your own matchup: a lead changing hands (either way, with the
--             play that did it), a comeback, a deficit cut close, a monster
--             game on either roster, a season high, a game inside a point
--             late, and the final. ON by default, the same rule as every
--             other kind: a manager who never opened the settings should
--             still hear that he lost the lead.
--
--   moment    the league's Steakhouse moments (level 4) in other people's
--             games. OFF by default: eleven other tables are interesting to
--             watch and noise to be buzzed about, unless you asked.
--
-- What is NOT pushed: an ordinary touchdown, a catch, a red-zone trip. A
-- touchdown that takes the lead is pushed, as the lead change it is.
--
-- RESTRAINT. A lead change and a final always go out. Everything
-- else on gameday waits if this manager was pushed about game day in the last
-- two minutes — the detector can write a monster game and a squeeze in the
-- same pass, and one buzz is the right number. Moments are at most one every
-- ten minutes. The service worker tags by kind, so a new game-day push
-- replaces the last one on the lock screen rather than stacking six.
--
-- SAFETY. The trigger is wrapped: a failure here is logged to ingest_log and
-- swallowed, because ff_sunday_detect_all runs the whole league's pass in one
-- block and a push problem must never cost the league its events.
--
-- `ff_notify`, `ff_notification_prefs` and `ff_set_notification_prefs` are
-- restated in full from 20260920014513, with the two new kinds and switches.
-- ============================================================================

-- ------------------------------------------------------------- the kinds --

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('trade','waiver','challenge','recap','announcement','mention','gameday','moment'));

alter table public.notification_prefs
  add column if not exists gameday boolean not null default true,
  add column if not exists moments boolean not null default false;

comment on column public.notification_prefs.gameday is
  'Your own matchup on game day: lead changes, comebacks, a deficit cut close, monster games, the final. On by default.';
comment on column public.notification_prefs.moments is
  'Steakhouse moments (level 4) in other managers'' games. Off by default — the one kind a manager has to ask for.';

-- ------------------------------------------------------------ the switches --

create or replace function public.ff_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'trades',        coalesce((select trades        from notification_prefs where user_id = auth.uid()), true),
    'waivers',       coalesce((select waivers       from notification_prefs where user_id = auth.uid()), true),
    'challenges',    coalesce((select challenges    from notification_prefs where user_id = auth.uid()), true),
    'recaps',        coalesce((select recaps        from notification_prefs where user_id = auth.uid()), true),
    'announcements', coalesce((select announcements from notification_prefs where user_id = auth.uid()), true),
    'mentions',      coalesce((select mentions      from notification_prefs where user_id = auth.uid()), true),
    'gameday',       coalesce((select gameday       from notification_prefs where user_id = auth.uid()), true),
    'moments',       coalesce((select moments       from notification_prefs where user_id = auth.uid()), false),
    'devices',       (select count(*) from push_subscriptions where user_id = auth.uid()))
  where auth.uid() is not null
$$;

-- Dropped rather than overloaded, as every widening of this RPC has been.
drop function if exists public.ff_set_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean);

create function public.ff_set_notification_prefs(
  p_trades boolean, p_waivers boolean, p_challenges boolean default null,
  p_recaps boolean default null, p_announcements boolean default null, p_mentions boolean default null,
  p_gameday boolean default null, p_moments boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into notification_prefs (user_id, trades, waivers, challenges, recaps, announcements, mentions, gameday, moments)
  values (auth.uid(), coalesce(p_trades, true), coalesce(p_waivers, true),
          coalesce(p_challenges, true), coalesce(p_recaps, true), coalesce(p_announcements, true),
          coalesce(p_mentions, true), coalesce(p_gameday, true), coalesce(p_moments, false))
  on conflict (user_id) do update
    set trades        = excluded.trades,
        waivers       = excluded.waivers,
        challenges    = coalesce(p_challenges, notification_prefs.challenges),
        recaps        = coalesce(p_recaps, notification_prefs.recaps),
        announcements = coalesce(p_announcements, notification_prefs.announcements),
        mentions      = coalesce(p_mentions, notification_prefs.mentions),
        gameday       = coalesce(p_gameday, notification_prefs.gameday),
        moments       = coalesce(p_moments, notification_prefs.moments),
        updated_at    = now();
  return ff_notification_prefs();
end $$;

-- ------------------------------------------------------------- the writer --
-- As 20260920014513, but for the two new branches — and `moment` defaults to
-- false where every other kind defaults to true.

create or replace function public.ff_notify(
  p_user uuid, p_kind text, p_title text, p_body text, p_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_wants boolean;
begin
  if p_user is null then return null; end if;
  if not exists (select 1 from push_subscriptions where user_id = p_user) then
    return null;
  end if;

  select case p_kind
           when 'trade'        then coalesce(p.trades,        true)
           when 'waiver'       then coalesce(p.waivers,       true)
           when 'challenge'    then coalesce(p.challenges,    true)
           when 'recap'        then coalesce(p.recaps,        true)
           when 'announcement' then coalesce(p.announcements, true)
           when 'mention'      then coalesce(p.mentions,      true)
           when 'gameday'      then coalesce(p.gameday,       true)
           when 'moment'       then coalesce(p.moments,       false)
           else true end
    into v_wants
    from (select 1) _ left join notification_prefs p on p.user_id = p_user;

  if not coalesce(v_wants, true) then return null; end if;

  insert into notification_outbox (user_id, kind, title, body, url)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 400), coalesce(p_url, '/'))
  returning id into v_id;
  return v_id;
end $$;

-- -------------------------------------------------------------- who sits --

-- Everybody who holds a seat at a team: its manager and his co-owners.
create or replace function public.ff_team_users(p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id from teams where id = p_team_id and owner_id is not null
  union
  select user_id from team_co_owners where team_id = p_team_id
$$;

-- --------------------------------------------------------------- the words --

-- One event, told to one manager from his side of the table. Null when this
-- event is not one a manager is pushed about. Pure, so the test can read it.
create or replace function public.ff_gameday_words(p_event public.sunday_events, p_team uuid)
returns table (title text, body text, urgent boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f      constant text := 'FM99990.0';
  e      public.sunday_events := p_event;
  mine   boolean := e.team_id = p_team;
  who    text := public.ff_team_label(e.team_id);
  opp    text := public.ff_team_label(e.opponent_team_id);
  a      text := to_char(e.new_score, f);
  b      text := to_char(e.opp_new_score, f);
  pname  text;
  play   text := '';
  m      public.matchups%rowtype;
  home   boolean;
begin
  if e.player_id is not null then
    select full_name into pname from players where id = e.player_id;
  end if;
  if pname is not null and e.points_added is not null then
    play := ' ' || pname || ' ' || case when e.points_added >= 0 then '+' else '−' end
            || to_char(abs(e.points_added), f) || '.';
  end if;

  if e.event_type in ('lead_change', 'comeback')
     or (e.event_type in ('touchdown', 'big_play') and e.lead_change) then
    if mine then
      title := case when e.event_type = 'comeback' then 'Comeback — you lead ' || opp
                    else 'You take the lead over ' || opp end;
      body  := 'You ' || a || ', ' || opp || ' ' || b || '.' || play;
    else
      title := case when e.event_type = 'comeback' then who || ' comes back on you'
                    else who || ' takes the lead' end;
      body  := who || ' ' || a || ', you ' || b || '.' || play;
    end if;
    -- A comeback is written straight after the lead change it explains; it
    -- waits behind that push rather than buzzing a second time.
    urgent := e.event_type <> 'comeback';

  elsif e.event_type = 'tightening' then
    if mine then
      title := 'You''re within ' || to_char(e.opp_new_score - e.new_score, f) || ' of ' || opp;
      body  := coalesce(e.description, 'Game on.') || '. You ' || a || ', ' || opp || ' ' || b || '.';
    else
      title := who || ' is closing in';
      body  := 'Your lead is down to ' || to_char(e.opp_new_score - e.new_score, f)
               || ' — ' || who || ' ' || lower(coalesce(e.description, 'was further back')) || '.';
    end if;
    urgent := false;

  elsif e.event_type = 'monster_game' then
    if mine then
      title := coalesce(pname, 'Your man') || ': ' || to_char((e.detail->>'points')::numeric, f) || ' for you';
      body  := 'Monster game. You ' || a || ', ' || opp || ' ' || b || '.';
    else
      title := coalesce(pname, 'Their man') || ' has ' || to_char((e.detail->>'points')::numeric, f) || ' for ' || who;
      body  := 'Monster game against you. You ' || b || ', ' || who || ' ' || a || '.';
    end if;
    urgent := false;

  elsif e.event_type = 'season_high' then
    title := case when mine then 'You set the season high' else who || ' set the season high' end;
    body  := coalesce(e.description, a) || '.';
    urgent := false;

  elsif e.event_type = 'final' then
    if e.new_score = e.opp_new_score then
      title := 'Final: a dead heat';
      body  := a || ' apiece.';
    elsif mine then
      title := 'Final: you beat ' || opp;
      body  := a || '–' || b || '.' || coalesce(' ' || e.description || '.', '');
    else
      title := 'Final: ' || who || ' beat you';
      body  := a || '–' || b || '.' || coalesce(' ' || e.description || '.', '');
    end if;
    urgent := true;

  elsif e.event_type = 'close_game' and e.level >= 4 then
    -- Written with no team: old_score is the home side's, new_score the away's.
    select * into m from matchups where id = e.matchup_id;
    home := m.home_team_id = p_team;
    title := 'Inside a point, late';
    body  := 'You ' || to_char(case when home then e.old_score else e.new_score end, f)
             || ', ' || public.ff_team_label(case when home then m.away_team_id else m.home_team_id end)
             || ' ' || to_char(case when home then e.new_score else e.old_score end, f)
             || '.' || coalesce(' ' || e.description || '.', '');
    urgent := false;

  else
    return;
  end if;
  return next;
end $$;

-- -------------------------------------------------------------- the trigger --

create or replace function public.ff_on_sunday_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matchups%rowtype;
  v_team  uuid;
  v_user  uuid;
  v_title text;
  v_body  text;
  v_urgent boolean;
  v_url   text;
begin
  begin
    if new.matchup_id is null then return null; end if;
    select * into m from matchups where id = new.matchup_id;
    if not found then return null; end if;
    v_url := format('/matchups/%s?week=%s', new.matchup_id, new.week);

    -- The two managers at the table, from their own side of it.
    foreach v_team in array array[m.home_team_id, m.away_team_id] loop
      v_title := null;
      select x.title, x.body, x.urgent into v_title, v_body, v_urgent
        from public.ff_gameday_words(new, v_team) x;
      if v_title is null then continue; end if;
      for v_user in select * from public.ff_team_users(v_team) loop
        -- One buzz is the right number: what can wait, waits two minutes.
        if not v_urgent and exists (
             select 1 from notification_outbox o
              where o.user_id = v_user and o.kind = 'gameday'
                and o.created_at > now() - interval '2 minutes') then
          continue;
        end if;
        perform public.ff_notify(v_user, 'gameday', v_title, v_body, v_url);
      end loop;
    end loop;

    -- Everybody else in the league who asked for the big ones.
    if new.level >= 4 and new.event_type <> 'red_zone' then
      for v_user in
        select u from teams t, lateral public.ff_team_users(t.id) u
         where t.league_id = new.league_id and t.id not in (m.home_team_id, m.away_team_id)
      loop
        if exists (select 1 from notification_outbox o
                    where o.user_id = v_user and o.kind = 'moment'
                      and o.created_at > now() - interval '10 minutes') then
          continue;
        end if;
        perform public.ff_notify(v_user, 'moment', left('🚨 ' || new.headline, 120),
          coalesce(new.description, 'A Steakhouse moment.'), v_url);
      end loop;
    end if;
  exception when others then
    insert into ingest_log (source, event, detail)
    values ('push', 'gameday_failed', jsonb_build_object('event', new.id, 'error', sqlerrm));
  end;
  return null;
end $$;

drop trigger if exists sunday_events_notify on public.sunday_events;
create trigger sunday_events_notify
  after insert on public.sunday_events
  for each row execute function public.ff_on_sunday_event();

-- ------------------------------------------------------------- the grants --
-- See 20260906011030: default privileges hand EXECUTE to authenticated, so the
-- service-only functions name it explicitly.
revoke execute on function public.ff_notification_prefs()                                                                    from public, anon;
revoke execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
revoke execute on function public.ff_notify(uuid,text,text,text,text)                                                        from public, anon, authenticated;
revoke execute on function public.ff_team_users(uuid)                                                                        from public, anon, authenticated;
revoke execute on function public.ff_gameday_words(public.sunday_events, uuid)                                               from public, anon, authenticated;
revoke execute on function public.ff_on_sunday_event()                                                                       from public, anon, authenticated;

grant execute on function public.ff_notification_prefs()                                                                     to authenticated, service_role;
grant execute on function public.ff_set_notification_prefs(boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean)  to authenticated, service_role;
grant execute on function public.ff_notify(uuid,text,text,text,text)                                                         to service_role;
