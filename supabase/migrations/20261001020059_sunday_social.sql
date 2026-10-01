-- ============================================================================
-- Steakhouse Sunday, phase 3: the room joins the broadcast.
--
-- Phase 2 made the Fantasy RedZone say what happened. This makes it something
-- the league can answer — without leaving the game center, and without a
-- second chat, a second reaction system or a second challenge feed. Every
-- piece below is an existing table or function taught one more thing.
--
-- REACTIONS. `reactions` already holds the league's one-tap reactions for
-- messages, events, polls and draft picks, and `ff_react` already toggles
-- them. It learns a fifth stream, 'sunday' — a sunday_events row, checked to
-- be in the caller's league like the others — and the palette gains 😡, the
-- one glyph the game center's six (😂 🔥 💀 🥩 🤡 😡) did not already have.
-- `ff_react` is restated from the live definition, which already asks
-- `ff_seat_team` so co-owners can react.
--
-- TALK. "Talk shit" is a chat message with the moment attached.
-- `ff_talk_about(league, event, body)` writes an ordinary `league_messages`
-- row — the same room, the same /chat — whose body is the context line the
-- server writes from the event itself, then what the manager typed under it:
--
--   🔥 Trav just took the lead over Mike, 117.3–114.8.
--   absolute fraud
--
-- The context is built here, not sent by the browser, so nobody can attach a
-- moment that did not happen. The row also carries `sunday_event_id`, so the
-- feed can count the talk on each card and the recap can find the most
-- talked-about moment of the day. The same rules as `ff_send_message` apply:
-- members only, 1 to 1000 characters in all.
--
-- ACTIVITY. `ff_sunday` gains `activity`: what the league's people did, to sit
-- in the feed between what the football did. Challenge moves come from
-- `challenge_events`, the audit trail the challenges trigger already writes
-- (proposed, accepted, declined, settled). Chat comes in only when it is part
-- of the day — talk attached to a moment, or a line the room reacted to three
-- times or more — so the feed is not the chat twice. Each event also carries
-- its reactions (with the caller's own marked) and how much talk it drew.
-- ============================================================================

-- ------------------------------------------------------------- reactions --

alter table public.reactions drop constraint if exists reactions_source_check;
alter table public.reactions add constraint reactions_source_check
  check (source in ('message', 'event', 'poll', 'pick', 'sunday'));

alter table public.reactions drop constraint if exists reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check
  check (emoji in ('🔥','😂','💀','👀','🫡','🥩','🗑️','🧂','🤡','😡','COOKED','FRAUD'));

comment on column public.reactions.emoji is
  'One of the league''s fixed palette: six original tallies plus 🗑️/🧂/🤡, the word reactions COOKED/FRAUD, and 😡 for the game center. Anything a manager can type is something a manager can type at somebody, so this stays a CHECK, not free text.';

create or replace function public.ff_react(
  p_league_id uuid,
  p_source    text,
  p_target_id uuid,
  p_emoji     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_n integer; v_on boolean; v_ok boolean;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if p_source not in ('message','event','poll','pick','sunday') then raise exception 'no such feed'; end if;

  if not exists (select 1 from teams where id = public.ff_seat_team(p_league_id, v_uid))
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  -- The target must exist, in this league, in the stream it says it is in. A
  -- pick reaches its league through its draft, which is the only table in this
  -- CASE that does not carry league_id itself.
  v_ok := case p_source
    when 'message' then exists (select 1 from league_messages  where id = p_target_id and league_id = p_league_id)
    when 'event'   then exists (select 1 from activity_events where id = p_target_id and league_id = p_league_id)
    when 'poll'    then exists (select 1 from polls           where id = p_target_id and league_id = p_league_id)
    when 'pick'    then exists (select 1 from draft_picks dp
                                  join drafts d on d.id = dp.draft_id
                                 where dp.id = p_target_id and d.league_id = p_league_id)
    when 'sunday'  then exists (select 1 from sunday_events   where id = p_target_id and league_id = p_league_id)
  end;
  if not v_ok then raise exception 'no such line in this league'; end if;

  delete from reactions
   where source = p_source and target_id = p_target_id
     and user_id = v_uid and emoji = p_emoji;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    insert into reactions (league_id, source, target_id, user_id, emoji)
    values (p_league_id, p_source, p_target_id, v_uid, p_emoji);
    v_on := true;
  else
    v_on := false;
  end if;

  return jsonb_build_object(
    'emoji', p_emoji,
    'mine',  v_on,
    'count', (select count(*) from reactions
               where source = p_source and target_id = p_target_id and emoji = p_emoji));
end $$;

revoke execute on function public.ff_react(uuid, text, uuid, text) from public, anon;
grant execute on function public.ff_react(uuid, text, uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ talk --

alter table public.league_messages
  add column if not exists sunday_event_id uuid references public.sunday_events(id) on delete set null;

create index if not exists league_messages_sunday_event_idx
  on public.league_messages (sunday_event_id) where sunday_event_id is not null;

comment on column public.league_messages.sunday_event_id is
  'The Steakhouse Sunday moment this line was said about, when it came from Talk shit. The body already carries the moment in words; this is for counting and for the recap.';

-- The moment, in one line, the way the room would say it. Numbers to one
-- decimal, as every score on the page is printed.
create or replace function public.ff_sunday_context(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case e.event_type
           when 'lead_change' then
             '🔥 ' || replace(e.headline, ' takes the lead over ', ' just took the lead over ')
             || coalesce(', ' || to_char(e.new_score, 'FM99990.0') || '–' || to_char(e.opp_new_score, 'FM99990.0'), '') || '.'
           when 'touchdown' then
             '🏈 ' || e.headline
             || coalesce(', ' || case when e.points_added >= 0 then '+' else '−' end
                         || to_char(abs(e.points_added), 'FM99990.0') || ' ' || (e.detail->>'who'), '')
             || case when e.lead_change then ' — ' || replace(coalesce(e.description, ''), ' takes the lead over ', ' just took the lead over ') else '' end
             || '.'
           when 'big_play' then
             '💥 ' || e.headline
             || coalesce(', ' || '+' || to_char(e.points_added, 'FM99990.0') || ' ' || (e.detail->>'who'), '') || '.'
           when 'turnover' then
             '😬 ' || e.headline
             || coalesce(', ' || '−' || to_char(abs(e.points_added), 'FM99990.0') || ' ' || (e.detail->>'who'), '') || '.'
           when 'close_game'  then '😬 Close game: ' || e.headline || '.'
           when 'upset_watch' then '👀 Upset watch: ' || e.headline || coalesce(' — ' || e.description, '') || '.'
           when 'red_zone'    then '🔴 ' || e.headline || '.'
           when 'final'       then '🏁 Final: ' || e.headline || '.'
           else e.headline
         end
    from sunday_events e where e.id = p_event_id
$$;

revoke all on function public.ff_sunday_context(uuid) from public, anon, authenticated;

create or replace function public.ff_talk_about(p_league_id uuid, p_event_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_said    text := btrim(coalesce(p_body, ''));
  v_context text;
  v_body    text;
  v_id      uuid;
  v_at      timestamptz;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;

  if not exists (select 1 from sunday_events where id = p_event_id and league_id = p_league_id) then
    raise exception 'no such moment in this league';
  end if;

  v_context := public.ff_sunday_context(p_event_id);
  v_body    := v_context || E'\n' || v_said;

  if char_length(v_said) < 1 then raise exception 'say something about it'; end if;
  if char_length(v_body) > 1000 then
    raise exception 'that is % characters too long', char_length(v_body) - 1000;
  end if;

  insert into league_messages (league_id, author_id, body, sunday_event_id)
  values (p_league_id, v_uid, v_body, p_event_id)
  returning id, created_at into v_id, v_at;

  return jsonb_build_object('id', v_id, 'at', v_at, 'context', v_context);
end $$;

revoke all on function public.ff_talk_about(uuid, uuid, text) from public, anon;
grant execute on function public.ff_talk_about(uuid, uuid, text) to authenticated;

comment on function public.ff_talk_about(uuid, uuid, text) is
  'Talk shit: post to the league chat about a Steakhouse Sunday moment. The server writes the moment as the first line; the caller''s words go under it.';

-- ------------------------------------------------------------ the center --
-- ff_sunday, restated from 20260930235409 with each event's reactions and
-- talk, and the league's `activity` beside the events.

create or replace function public.ff_sunday(p_league_id uuid, p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_board    jsonb;
  v_season   integer;
  v_week     integer;
  v_nfl      jsonb;
  v_events   jsonb;
  v_activity jsonb;
begin
  -- The guard: sign-in, league, membership. It raises before anything below
  -- is read, so this function can never show more than the board would.
  v_board := public.ff_scoreboard(p_league_id, p_week);

  v_season := (v_board->'league'->>'season')::integer;
  v_week   := (v_board->>'week')::integer;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id,
           'home', g.home_team,
           'away', g.away_team,
           'home_score', g.home_score,
           'away_score', g.away_score,
           'kickoff_at', g.kickoff_at,
           'status', g.status,
           'detail', g.status_detail,
           'home_spread', g.home_spread,
           'possession', g.possession,
           'red_zone', g.red_zone,
           'down_distance', g.down_distance,
           'updated_at', g.updated_at
         ) order by g.kickoff_at nulls last, g.home_team), '[]'::jsonb)
    into v_nfl
    from nfl_games g
   where g.season = v_season and g.season_type = 2 and g.week = v_week;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'type', e.event_type,
           'level', e.level,
           'priority', e.priority,
           'matchup_id', e.matchup_id,
           'team_id', e.team_id,
           'opponent_team_id', e.opponent_team_id,
           'player_id', e.player_id,
           'player_name', p.full_name,
           'espn_id', (select max(x.source_id) from player_id_map x
                        where x.player_id = e.player_id and x.source in ('espn','espn_team')),
           'nfl_game_id', e.nfl_game_id,
           'points_added', e.points_added,
           'old_score', e.old_score,
           'new_score', e.new_score,
           'opp_old_score', e.opp_old_score,
           'opp_new_score', e.opp_new_score,
           'lead_change', e.lead_change,
           'headline', e.headline,
           'description', e.description,
           'detail', e.detail,
           'created_at', e.created_at,
           -- Most-used first, with the caller's own marked so a tap can take
           -- one back.
           'reactions', coalesce((
             select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine)
                              order by r.n desc, r.emoji)
               from (select emoji, count(*) as n, bool_or(user_id = v_uid) as mine
                       from reactions where source = 'sunday' and target_id = e.id
                      group by emoji) r), '[]'::jsonb),
           'talk', (select count(*) from league_messages m where m.sunday_event_id = e.id)
         ) order by e.created_at desc, e.priority desc), '[]'::jsonb)
    into v_events
    from (select * from sunday_events x
           where x.league_id = p_league_id and x.season = v_season and x.week = v_week
           order by x.created_at desc, x.priority desc
           limit 150) e
    left join players p on p.id = e.player_id;

  -- What the league's people did, newest first: challenge moves from the audit
  -- trail, and the chat that is part of the day.
  select coalesce(jsonb_agg(a.x order by a.at desc), '[]'::jsonb)
    into v_activity
    from (
      (select ce.created_at as at, jsonb_build_object(
                'id', 'ch:' || ce.id,
                'kind', 'challenge',
                'at', ce.created_at,
                'verb', case ce.to_status when 'proposed' then 'proposed'
                                          when 'accepted' then 'accepted'
                                          when 'declined' then 'declined'
                                          else 'settled' end,
                -- The one who moved, and the one it was aimed at.
                'who', public.ff_team_label(public.ff_seat_team(p_league_id,
                         case when ce.to_status in ('accepted', 'declined') then c.opponent_id else c.challenger_id end)),
                'opp', public.ff_team_label(public.ff_seat_team(p_league_id,
                         case when ce.to_status in ('accepted', 'declined') then c.challenger_id else c.opponent_id end)),
                'winner', public.ff_team_label(public.ff_seat_team(p_league_id, c.winner_id)),
                'title', c.title,
                'stake', c.stake_label,
                'challenge_id', c.id,
                'matchup_id', c.matchup_id) as x
         from challenge_events ce
         join challenges c on c.id = ce.challenge_id
        where c.league_id = p_league_id
          and ce.created_at > now() - interval '7 days'
          and ce.to_status in ('proposed', 'accepted', 'declined', 'resolved')
        order by ce.created_at desc
        limit 20)
      union all
      (select lm.created_at, jsonb_build_object(
                'id', 'msg:' || lm.id,
                'kind', 'chat',
                'at', lm.created_at,
                'verb', 'said',
                'who', public.ff_team_label(public.ff_seat_team(p_league_id, lm.author_id)),
                'body', lm.body,
                'reactions', rx.n,
                'message_id', lm.id,
                'sunday_event_id', lm.sunday_event_id) as x
         from league_messages lm
         cross join lateral (select count(*) as n from reactions r
                              where r.source = 'message' and r.target_id = lm.id) rx
        where lm.league_id = p_league_id and lm.kind = 'manager'
          and lm.created_at > now() - interval '2 days'
          and (lm.sunday_event_id is not null or rx.n >= 3)
        order by lm.created_at desc
        limit 20)
    ) a;

  return v_board || jsonb_build_object('nfl', v_nfl, 'events', v_events, 'activity', v_activity);
end $fn$;

revoke all on function public.ff_sunday(uuid, integer) from public, anon;
grant execute on function public.ff_sunday(uuid, integer) to authenticated;

comment on function public.ff_sunday(uuid, integer) is
  'Steakhouse Sunday: ff_scoreboard for the week plus `nfl` (the week''s NFL games with possession and red zone), `events` (the newest 150 Fantasy RedZone events, each with its reactions and talk) and `activity` (challenge moves and the chat that is part of the day). Members only, by way of ff_scoreboard''s own guard.';
