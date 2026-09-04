-- ============================================================================
-- The Weekly Special.
--
-- The recap already existed, twice, and neither one was a post. `recapText`
-- writes the week for a share sheet, which requires somebody to press share;
-- Tuesday's briefing tells *you* what happened to *you*. Neither leaves
-- anything behind for the league to argue with on Wednesday.
--
-- So the house writes it, once a week, into the clubhouse.
--
--   `ff_week_recap`   the facts: every result, the high and the low, the
--                     blowout, the one-score game, the week's best player, and
--                     the bench decision that actually cost somebody the game.
--   `ff_recap_body`   the facts as prose, in the house voice. Immutable and
--                     separately testable, which matters: the facts need a
--                     played week and the words do not.
--   `ff_publish_recap`  writes the recap and posts it. Idempotent on
--                     (league, week) — a second run is a no-op, not a second
--                     post.
--   `ff_post_weekly_recaps`  the cron entry: publish the newest finished week
--                     that has not been written up yet, and swallow its own
--                     failures the way every other scheduled job here does.
--
-- A house post is a message with no author. `league_messages.author_id` was
-- NOT NULL, so it gains a `kind` and loses that constraint — the alternative
-- was posting as the commissioner, which is a lie about who wrote it.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

-- ------------------------------------------------------------ house posts --

alter table public.league_messages alter column author_id drop not null;

alter table public.league_messages
  add column if not exists kind text not null default 'manager';

do $$ begin
  alter table public.league_messages
    add constraint league_messages_kind_check check (kind in ('manager', 'house'));
exception when duplicate_object then null; end $$;

-- A manager's line must still be signed. Only the house may be anonymous.
do $$ begin
  alter table public.league_messages
    add constraint league_messages_author_check
    check ((kind = 'house') = (author_id is null));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- recaps --

create table if not exists public.league_recaps (
  league_id  uuid not null references public.leagues(id) on delete cascade,
  week       integer not null,
  facts      jsonb not null,
  body       text not null,
  -- The clubhouse post this became. Null if the post was later deleted.
  message_id uuid references public.league_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (league_id, week)
);

alter table public.league_recaps enable row level security;

drop policy if exists league_recaps_read on public.league_recaps;
create policy league_recaps_read on public.league_recaps
  for select to authenticated using (public.ff_is_member());

grant select on public.league_recaps to authenticated;
revoke all on public.league_recaps from anon;

-- ------------------------------------------------------------------- who --

-- "Dave" if the commissioner typed a name, the team otherwise. The same rule
-- `who()` follows in the browser, so the house voice and the card agree.
create or replace function public.ff_who(p_manager text, p_name text)
returns text
language sql
immutable
as $fn$
  select coalesce(nullif(split_part(btrim(coalesce(p_manager, '')), ' ', 1), ''), p_name)
$fn$;

-- ----------------------------------------------------------------- facts --

create or replace function public.ff_week_recap(p_league_id uuid, p_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_league leagues%rowtype;
  v_facts  jsonb;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  -- Readable by the league; written by the house. The cron calls it with no
  -- session, which is the one caller allowed past this.
  if v_uid is not null
     and not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  with mus as (
    select m.id, m.home_team_id, m.away_team_id,
           round(m.home_points, 2) as home_points,
           round(m.away_points, 2) as away_points,
           th.name as home_team, ta.name as away_team,
           public.ff_who(th.manager_name, th.name) as home_who,
           public.ff_who(ta.manager_name, ta.name) as away_who
      from matchups m
      join teams th on th.id = m.home_team_id
      join teams ta on ta.id = m.away_team_id
     where m.league_id = p_league_id and m.week = p_week
  ),
  -- One row per team, so the high, the low and the bench all read the same way.
  sides as (
    select id as matchup_id, home_team_id as team_id, home_points as pf,
           away_points as pa, home_who as who, home_team as team from mus
    union all
    select id, away_team_id, away_points, home_points, away_who, away_team from mus
  ),
  bench as (
    select s.who, s.team, s.pf - s.pa as margin,
           (select rp.full_name from roster_points rp
             where rp.team_id = s.team_id and rp.week = p_week and rp.slot = 'BN'
             order by rp.points desc, rp.full_name limit 1) as full_name,
           (select max(rp.points) from roster_points rp
             where rp.team_id = s.team_id and rp.week = p_week and rp.slot = 'BN') as best,
           (select min(rp.points) from roster_points rp
             where rp.team_id = s.team_id and rp.week = p_week and rp.slot <> 'BN') as worst
      from sides s
  )
  select jsonb_build_object(
    'week', p_week,
    'season', v_league.season,
    'league_name', v_league.name,
    'games', (select count(*) from mus),
    -- A week nobody has played is not a week to write about.
    'played', (select count(*) from mus where home_points + away_points > 0) > 0,

    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'home', home_who, 'away', away_who,
               'home_team', home_team, 'away_team', away_team,
               'home_points', home_points, 'away_points', away_points,
               'winner', case when home_points > away_points then home_who
                              when away_points > home_points then away_who end,
               'loser',  case when home_points > away_points then away_who
                              when away_points > home_points then home_who end,
               'margin', round(abs(home_points - away_points), 2))
             order by abs(home_points - away_points) desc)
        from mus), '[]'::jsonb),

    'high', (select jsonb_build_object('who', who, 'team', team, 'points', pf)
               from sides order by pf desc, who limit 1),
    'low',  (select jsonb_build_object('who', who, 'team', team, 'points', pf)
               from sides order by pf asc, who limit 1),

    'blowout', (select jsonb_build_object(
                         'winner', case when home_points > away_points then home_who else away_who end,
                         'loser',  case when home_points > away_points then away_who else home_who end,
                         'margin', round(abs(home_points - away_points), 2))
                  from mus where home_points <> away_points
                 order by abs(home_points - away_points) desc limit 1),

    'nailbiter', (select jsonb_build_object(
                           'winner', case when home_points > away_points then home_who else away_who end,
                           'loser',  case when home_points > away_points then away_who else home_who end,
                           'margin', round(abs(home_points - away_points), 2))
                    from mus where home_points <> away_points
                   order by abs(home_points - away_points) asc limit 1),

    'top_player', (select jsonb_build_object(
                            'full_name', rp.full_name, 'position', rp.position,
                            'nfl_team', rp.nfl_team, 'points', round(rp.points, 2),
                            'who', public.ff_who(t.manager_name, t.name))
                     from roster_points rp
                     join teams t on t.id = rp.team_id
                    where rp.league_id = p_league_id and rp.week = p_week and rp.slot <> 'BN'
                    order by rp.points desc, rp.full_name limit 1),

    -- The bench decision that actually cost somebody the game: a loser whose
    -- best reserve beat their worst starter by more than they lost by. Without
    -- that test it is just a player who had a good day on a bench.
    'bench', (select jsonb_build_object(
                       'who', who, 'team', team, 'full_name', full_name,
                       'points', round(best, 2), 'margin', round(-margin, 2),
                       'swing', round(best - worst, 2))
                from bench
               where margin < 0 and full_name is not null
                 and best is not null and worst is not null
                 and (best - worst) > -margin
               order by (best - worst) desc limit 1),

    'generated_at', now()
  ) into v_facts;

  return v_facts;
end;
$fn$;

-- ------------------------------------------------------------------ prose --

-- Immutable, and takes the facts rather than the league: the words can be
-- tested without a played week, which is the only way this got tested at all.
create or replace function public.ff_recap_body(p_facts jsonb)
returns text
language plpgsql
immutable
as $fn$
declare
  v_lines text[] := array[]::text[];
  v_row   jsonb;
  v_hi    jsonb := p_facts->'high';
  v_lo    jsonb := p_facts->'low';
  v_blow  jsonb := p_facts->'blowout';
  v_nail  jsonb := p_facts->'nailbiter';
  v_top   jsonb := p_facts->'top_player';
  v_bench jsonb := p_facts->'bench';
  v_n     text;
begin
  if p_facts is null or not coalesce((p_facts->>'played')::boolean, false) then
    return null;
  end if;

  v_lines := array_append(v_lines,
    format('The Weekly Special · Week %s', p_facts->>'week'));
  v_lines := array_append(v_lines, '');

  -- The card: every table, the widest margin first.
  for v_row in select * from jsonb_array_elements(p_facts->'results') loop
    if (v_row->>'winner') is null then
      v_lines := array_append(v_lines, format('%s %s — %s %s (tie)',
        v_row->>'home', to_char((v_row->>'home_points')::numeric, 'FM999990.0'),
        v_row->>'away', to_char((v_row->>'away_points')::numeric, 'FM999990.0')));
    else
      v_lines := array_append(v_lines, format('%s %s — %s %s',
        v_row->>'winner',
        to_char(greatest((v_row->>'home_points')::numeric, (v_row->>'away_points')::numeric), 'FM999990.0'),
        v_row->>'loser',
        to_char(least((v_row->>'home_points')::numeric, (v_row->>'away_points')::numeric), 'FM999990.0')));
    end if;
  end loop;

  v_lines := array_append(v_lines, '');

  if v_hi is not null and v_hi <> 'null'::jsonb then
    v_lines := array_append(v_lines, format('Tonight''s Specials: %s, %s.',
      v_hi->>'who', to_char((v_hi->>'points')::numeric, 'FM999990.0')));
  end if;

  -- Only worth saying in a league big enough that last is not also the loser
  -- of the one game played.
  if v_lo is not null and v_lo <> 'null'::jsonb
     and coalesce((p_facts->>'games')::int, 0) >= 3 then
    v_lines := array_append(v_lines, format('Sent back to the kitchen: %s, %s.',
      v_lo->>'who', to_char((v_lo->>'points')::numeric, 'FM999990.0')));
  end if;

  if v_blow is not null and v_blow <> 'null'::jsonb
     and (v_blow->>'margin')::numeric >= 25 then
    v_lines := array_append(v_lines, format('The Bill: %s by %s over %s.',
      v_blow->>'winner', to_char((v_blow->>'margin')::numeric, 'FM999990.0'), v_blow->>'loser'));
  end if;

  if v_nail is not null and v_nail <> 'null'::jsonb
     and (v_nail->>'margin')::numeric <= 5
     and (v_blow is null or v_blow = 'null'::jsonb
          or (v_nail->>'winner') is distinct from (v_blow->>'winner')) then
    v_lines := array_append(v_lines, format('Last Call: %s edged %s by %s.',
      v_nail->>'winner', v_nail->>'loser', to_char((v_nail->>'margin')::numeric, 'FM999990.0')));
  end if;

  if v_bench is not null and v_bench <> 'null'::jsonb then
    v_lines := array_append(v_lines, format('Left on the pass: %s sat %s (%s) and lost by %s.',
      v_bench->>'who', v_bench->>'full_name',
      to_char((v_bench->>'points')::numeric, 'FM999990.0'),
      to_char((v_bench->>'margin')::numeric, 'FM999990.0')));
  end if;

  if v_top is not null and v_top <> 'null'::jsonb then
    v_n := coalesce(nullif(v_top->>'nfl_team', ''), '');
    v_lines := array_append(v_lines, format('Player of the week: %s%s, %s, for %s.',
      v_top->>'full_name',
      case when v_n = '' then '' else ' (' || v_n || ')' end,
      to_char((v_top->>'points')::numeric, 'FM999990.0'),
      v_top->>'who'));
  end if;

  return array_to_string(v_lines, E'\n');
end;
$fn$;

-- ---------------------------------------------------------------- publish --

create or replace function public.ff_publish_recap(p_league_id uuid, p_week integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_facts jsonb;
  v_body  text;
  v_msg   uuid;
  v_rows  integer;
begin
  -- Returns silently for the cron (no session); the commissioner may also run
  -- it by hand. An ordinary member may not put words in the house's mouth.
  perform public.ff_assert_commissioner(p_league_id);

  if exists (select 1 from league_recaps where league_id = p_league_id and week = p_week) then
    return (select jsonb_build_object('week', week, 'posted', false, 'reason', 'already written',
                                      'message_id', message_id, 'body', body)
              from league_recaps where league_id = p_league_id and week = p_week);
  end if;

  v_facts := public.ff_week_recap(p_league_id, p_week);
  v_body  := public.ff_recap_body(v_facts);

  if v_body is null then
    return jsonb_build_object('week', p_week, 'posted', false, 'reason', 'nothing played');
  end if;

  -- The recap row is the lock. Claim the week first and post second, so a
  -- race leaves the room with one copy rather than two and a compensating
  -- delete.
  insert into league_recaps(league_id, week, facts, body)
  values (p_league_id, p_week, v_facts, v_body)
  on conflict (league_id, week) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return (select jsonb_build_object('week', week, 'posted', false, 'reason', 'already written',
                                      'message_id', message_id, 'body', body)
              from league_recaps where league_id = p_league_id and week = p_week);
  end if;

  insert into league_messages(league_id, author_id, kind, body)
  values (p_league_id, null, 'house', v_body)
  returning id into v_msg;

  update league_recaps set message_id = v_msg
   where league_id = p_league_id and week = p_week;

  return jsonb_build_object('week', p_week, 'posted', true, 'message_id', v_msg, 'body', v_body);
end;
$fn$;

-- ------------------------------------------------------------------- cron --

create or replace function public.ff_post_weekly_recaps()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_league  leagues%rowtype;
  v_week    integer;
  v_out     jsonb := '[]'::jsonb;
  v_one     jsonb;
begin
  for v_league in select * from leagues loop
    -- The newest week whose NFL games are all final and whose league games
    -- have scores, and which nobody has written up yet. Runs daily rather than
    -- on Tuesdays so a flexed game, a holiday or a missed run still gets its
    -- recap the day the week actually finishes.
    select max(g.week) into v_week
      from nfl_games g
     where g.season = v_league.season and g.season_type = 2
       and not exists (select 1 from nfl_games g2
                        where g2.season = g.season and g2.season_type = 2
                          and g2.week = g.week and g2.status <> 'post')
       and exists (select 1 from matchups m
                    where m.league_id = v_league.id and m.week = g.week
                      and m.home_points + m.away_points > 0)
       and not exists (select 1 from league_recaps r
                        where r.league_id = v_league.id and r.week = g.week);

    if v_week is null then continue; end if;

    begin
      v_one := public.ff_publish_recap(v_league.id, v_week);
    exception when others then
      -- A scheduled job that goes red on a bad week is a job somebody turns
      -- off. Record it and move on, like every other feed here.
      v_one := jsonb_build_object('week', v_week, 'posted', false, 'error', sqlerrm);
    end;

    v_out := v_out || jsonb_build_array(jsonb_build_object('league', v_league.id) || v_one);
  end loop;

  return jsonb_build_object('ran_at', now(), 'leagues', v_out);
end;
$fn$;

-- ------------------------------------------------------------- the readers --
-- Both restated to carry `kind` and to stop reading `author_id = auth.uid()`
-- as a boolean: against a house post that comparison is NULL, not false.

create or replace function public.ff_matchup_thread(p_matchup_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_mu     matchups%rowtype;
  v_league leagues%rowtype;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  select * into v_mu from matchups where id = p_matchup_id;
  if not found then raise exception 'matchup not found'; end if;

  select * into v_league from leagues where id = v_mu.league_id;

  -- Same door as ff_scoreboard and ff_briefing: signup is open, so membership
  -- is checked here rather than left to RLS.
  if not exists (select 1 from teams where league_id = v_mu.league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  return jsonb_build_object(
    'matchup_id', v_mu.id,
    'week', v_mu.week,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', lm.id,
               'body', lm.body,
               'created_at', lm.created_at,
               'edited_at', lm.edited_at,
               'author_id', lm.author_id,
               'kind', lm.kind,
               'mine', coalesce(lm.author_id = v_uid, false),
               'author_team_id', t.id,
               -- A manager who has left their seat still said it: the profile
               -- name, then the honest fallback, rather than a blank line.
               'author_name', case when lm.kind = 'house' then 'The House'
                                   else coalesce(t.name, pr.display_name, 'League manager') end,
               'author_manager', case when lm.kind = 'house' then 'The House'
                                      else coalesce(t.manager_name, pr.display_name) end,
               'author_logo', t.logo_path,
               'side', case when t.id = v_mu.home_team_id then 'home'
                            when t.id = v_mu.away_team_id then 'away' end
             ) order by lm.created_at)
        from league_messages lm
        left join teams t on t.owner_id = lm.author_id and t.league_id = v_mu.league_id
        left join profiles pr on pr.id = lm.author_id
       where lm.matchup_id = v_mu.id
    ), '[]'::jsonb),
    'now', now()
  );
end;
$fn$;

create or replace function public.ff_clubhouse_feed(p_league_id uuid, p_limit integer default 4)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_league leagues%rowtype;
  v_team   teams%rowtype;
  v_mu     matchups%rowtype;
  v_week   integer;
  v_limit  integer := least(greatest(coalesce(p_limit, 4), 1), 20);
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week := greatest(1, public.ff_current_week());

  select * into v_team from teams where league_id = p_league_id and owner_id = v_uid limit 1;

  if v_team.id is not null then
    select * into v_mu from matchups m
     where m.league_id = p_league_id and m.week = v_week
       and v_team.id in (m.home_team_id, m.away_team_id);
  end if;

  return jsonb_build_object(
    -- My own table's thread, so the front page can say "three about your
    -- table" without opening the scoreboard.
    'mine', case when v_mu.id is null then null else jsonb_build_object(
      'matchup_id', v_mu.id,
      'week', v_mu.week,
      'count', (select count(*) from league_messages lm where lm.matchup_id = v_mu.id),
      'last', (select jsonb_build_object(
                        'body', lm.body, 'created_at', lm.created_at,
                        'author', coalesce(t.manager_name, t.name, 'League manager'),
                        'mine', coalesce(lm.author_id = v_uid, false))
                 from league_messages lm
                 left join teams t on t.owner_id = lm.author_id and t.league_id = p_league_id
                where lm.matchup_id = v_mu.id
                order by lm.created_at desc limit 1)
    ) end,

    -- The last few lines anywhere: the room, the tables and the house, one feed.
    'recent', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc)
        from (
          select jsonb_build_object(
                   'id', lm.id, 'body', lm.body, 'created_at', lm.created_at,
                   'kind', lm.kind,
                   'author', case when lm.kind = 'house' then 'The House'
                                  else coalesce(t.manager_name, t.name, 'League manager') end,
                   'mine', coalesce(lm.author_id = v_uid, false),
                   'matchup_id', lm.matchup_id,
                   'about', case when lm.matchup_id is null then null else (
                     select jsonb_build_object(
                              'week', m2.week, 'home', th2.name, 'away', ta2.name,
                              'mine', (v_team.id is not null
                                       and v_team.id in (m2.home_team_id, m2.away_team_id)))
                       from matchups m2
                       join teams th2 on th2.id = m2.home_team_id
                       join teams ta2 on ta2.id = m2.away_team_id
                      where m2.id = lm.matchup_id) end
                 ) as x
            from league_messages lm
            left join teams t on t.owner_id = lm.author_id and t.league_id = p_league_id
           where lm.league_id = p_league_id
           order by lm.created_at desc
           limit v_limit
        ) q
    ), '[]'::jsonb),

    'count_7d', (select count(*) from league_messages lm
                  where lm.league_id = p_league_id
                    and lm.created_at > now() - interval '7 days'),
    'now', now()
  );
end;
$fn$;

revoke all on function public.ff_week_recap(uuid, integer) from public, anon;
revoke all on function public.ff_publish_recap(uuid, integer) from public, anon;
revoke all on function public.ff_post_weekly_recaps() from public, anon, authenticated;
grant execute on function public.ff_week_recap(uuid, integer) to authenticated;
grant execute on function public.ff_publish_recap(uuid, integer) to authenticated;

comment on function public.ff_week_recap(uuid, integer) is
  'Members only. The facts of one finished week: every result, the high and the low, the widest margin, the closest game, the best player, and the bench decision that cost somebody the game.';
comment on function public.ff_publish_recap(uuid, integer) is
  'Commissioner or the scheduler. Writes the week''s recap and posts it to the clubhouse as a house message. Idempotent on (league, week).';

-- 13:00 UTC is 9am in the league's zone, after `stats-settle` has re-pulled
-- Monday night's corrections at 09:17 UTC. Daily, not Tuesdays: the guard
-- above decides when a week is actually over.
select cron.schedule('weekly-recap', '0 13 * * *', 'select public.ff_post_weekly_recaps()');
