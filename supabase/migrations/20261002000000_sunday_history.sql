-- ============================================================================
-- Steakhouse Sunday, phase 5: the day is kept.
--
-- Phases 1-4 made Sunday something the league watches together. This makes it
-- something the league remembers — without a second history system. The
-- events are already persisted, a row per moment, per week, forever; the
-- matchup state already keeps lead changes and, since phase 4, how far each
-- side was down. The History wall already has the rivalries, the managers and
-- the records. What was missing is the reading of one into the other.
--
-- ff_sunday_recap(league, week) — what Tuesday's recap needs beyond the board
--   and the feed: each table's swings (lead changes, how far each side was
--   down), the challenges riding on the week's matchups and how they ended,
--   and the week's best chat line by reactions. Its own call, made only once a
--   week is over, so a live Sunday pays nothing for it.
--
-- ff_sunday_history(league) — Sunday on the History wall: the memorable
--   moments of every season the event engine has run (Steakhouse moments and
--   whatever the room reacted to most), the Sunday records (biggest comeback,
--   most lead changes, closest finish, biggest single play), and each
--   manager's Sunday line (moments, comebacks, lead changes taken,
--   touchdowns, reactions drawn).
--
-- Both read only; both members only. Nothing here is a new fact — every
-- number is a count or a maximum over rows the detector already wrote.
-- ============================================================================

create or replace function public.ff_sunday_recap(p_league_id uuid, p_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_season integer;
  v_from   timestamptz;
  v_to     timestamptz;
  v_out    jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  select season into v_season from leagues where id = p_league_id;

  -- The week's window, from its own slate: the night before the first kickoff
  -- to the morning after the last. A chat line outside it is another week's.
  select min(g.kickoff_at) - interval '12 hours', max(g.kickoff_at) + interval '16 hours'
    into v_from, v_to
    from nfl_games g
   where g.season = v_season and g.season_type = 2 and g.week = p_week;

  select jsonb_build_object(
    'week', p_week,
    'swings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'matchup_id', s.matchup_id,
               'lead_changes', s.lead_changes,
               'home_worst', s.home_worst,
               'away_worst', s.away_worst))
        from sunday_matchup_state s
        join matchups m on m.id = s.matchup_id
       where m.league_id = p_league_id and m.week = p_week), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'title', c.title,
               'stake', c.stake_label,
               'status', c.status,
               'matchup_id', c.matchup_id,
               'who', public.ff_team_label(public.ff_seat_team(p_league_id, c.challenger_id)),
               'opp', public.ff_team_label(public.ff_seat_team(p_league_id, c.opponent_id)),
               'winner', public.ff_team_label(public.ff_seat_team(p_league_id, c.winner_id)))
             order by c.created_at)
        from challenges c
        join matchups m on m.id = c.matchup_id
       where c.league_id = p_league_id and m.week = p_week
         and c.status not in ('declined', 'expired', 'voided')), '[]'::jsonb),
    'best_chat', (
      select jsonb_build_object(
               'id', lm.id,
               'who', public.ff_team_label(public.ff_seat_team(p_league_id, lm.author_id)),
               'body', lm.body,
               'at', lm.created_at,
               'reactions', rx.n,
               'sunday_event_id', lm.sunday_event_id)
        from league_messages lm
        cross join lateral (select count(*) as n from reactions r
                             where r.source = 'message' and r.target_id = lm.id) rx
       where lm.league_id = p_league_id and lm.kind = 'manager'
         and v_from is not null and lm.created_at between v_from and v_to
         and rx.n > 0
       order by rx.n desc, lm.created_at
       limit 1)
  ) into v_out;

  return v_out;
end $fn$;

revoke all on function public.ff_sunday_recap(uuid, integer) from public, anon;
grant execute on function public.ff_sunday_recap(uuid, integer) to authenticated;

comment on function public.ff_sunday_recap(uuid, integer) is
  'Steakhouse Sunday recap extras for one week: each table''s swings, the challenges riding on its matchups, and the best chat line by reactions. Members only.';

-- ---------------------------------------------------------------- history --

create or replace function public.ff_sunday_history(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  with ev as (
    select e.*,
           (select count(*) from reactions r where r.source = 'sunday' and r.target_id = e.id) as rx,
           (select count(*) from league_messages m where m.sunday_event_id = e.id) as talk
      from sunday_events e
     where e.league_id = p_league_id
  ),
  -- Finished tables only: a comeback is only a comeback once it held.
  fin as (
    select m.id, m.week, l.season, m.home_team_id, m.away_team_id, m.home_points, m.away_points,
           s.lead_changes, s.home_worst, s.away_worst
      from matchups m
      join leagues l on l.id = m.league_id
      join sunday_matchup_state s on s.matchup_id = m.id
     where m.league_id = p_league_id
       and public.ff_week_final(l.season, m.week)
       and m.home_points + m.away_points > 0
  )
  select jsonb_build_object(
    'moments', coalesce((
      select jsonb_agg(x.j order by x.rx desc, x.priority desc, x.created_at desc)
        from (
          select ev.rx, ev.priority, ev.created_at, jsonb_build_object(
                   'id', ev.id, 'season', ev.season, 'week', ev.week, 'type', ev.event_type,
                   'level', ev.level, 'headline', ev.headline, 'description', ev.description,
                   'matchup_id', ev.matchup_id, 'reactions', ev.rx, 'talk', ev.talk,
                   'at', ev.created_at) as j
            from ev
           where ev.level = 4 or ev.rx >= 3
           order by ev.rx desc, ev.priority desc, ev.created_at desc
           limit 12) x), '[]'::jsonb),
    'records', jsonb_build_object(
      'comeback', (
        select jsonb_build_object('season', f.season, 'week', f.week, 'matchup_id', f.id,
                 'who', public.ff_team_label(case when f.home_points > f.away_points then f.home_team_id else f.away_team_id end),
                 'opp', public.ff_team_label(case when f.home_points > f.away_points then f.away_team_id else f.home_team_id end),
                 'down', case when f.home_points > f.away_points then f.home_worst else f.away_worst end)
          from fin f
         where f.home_points <> f.away_points
           and (case when f.home_points > f.away_points then f.home_worst else f.away_worst end) > 0
         order by (case when f.home_points > f.away_points then f.home_worst else f.away_worst end) desc, f.season desc, f.week desc
         limit 1),
      'lead_changes', (
        select jsonb_build_object('season', f.season, 'week', f.week, 'matchup_id', f.id, 'n', f.lead_changes,
                 'home', public.ff_team_label(f.home_team_id), 'away', public.ff_team_label(f.away_team_id))
          from fin f where f.lead_changes > 0
         order by f.lead_changes desc, f.season desc, f.week desc
         limit 1),
      'closest', (
        select jsonb_build_object('season', f.season, 'week', f.week, 'matchup_id', f.id,
                 'margin', abs(f.home_points - f.away_points),
                 'who', public.ff_team_label(case when f.home_points >= f.away_points then f.home_team_id else f.away_team_id end),
                 'opp', public.ff_team_label(case when f.home_points >= f.away_points then f.away_team_id else f.home_team_id end))
          from fin f
         order by abs(f.home_points - f.away_points), f.season desc, f.week desc
         limit 1),
      'play', (
        select jsonb_build_object('season', ev.season, 'week', ev.week, 'id', ev.id,
                 'headline', ev.headline, 'points', ev.points_added,
                 'who', ev.detail->>'who')
          from ev
         where ev.event_type in ('touchdown', 'big_play') and ev.points_added > 0
         order by ev.points_added desc, ev.created_at desc
         limit 1)
    ),
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', t.id,
               'who', public.ff_team_label(t.id),
               'moments', (select count(*) from ev where ev.team_id = t.id and ev.level = 4),
               'comebacks', (select count(*) from ev where ev.team_id = t.id and ev.event_type = 'comeback'),
               'lead_changes', (select count(*) from ev where ev.team_id = t.id
                                  and (ev.event_type = 'lead_change' or (ev.lead_change and ev.event_type <> 'comeback'))),
               'touchdowns', (select count(*) from ev where ev.team_id = t.id and ev.event_type = 'touchdown'),
               'reactions', (select coalesce(sum(ev.rx), 0) from ev where ev.team_id = t.id))
             order by public.ff_team_label(t.id))
        from teams t
       where t.league_id = p_league_id), '[]'::jsonb),
    'weeks', (select count(distinct (season, week)) from ev)
  ) into v_out;

  return v_out;
end $fn$;

revoke all on function public.ff_sunday_history(uuid) from public, anon;
grant execute on function public.ff_sunday_history(uuid) to authenticated;

comment on function public.ff_sunday_history(uuid) is
  'Steakhouse Sunday on the History wall: memorable moments, Sunday records and each manager''s Sunday line, from the persisted events and matchup state. Members only.';
