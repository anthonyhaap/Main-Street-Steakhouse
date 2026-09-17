-- ============================================================================
-- The Weekly Special, with your line in it.
--
-- The house writes the week up every Tuesday and posts it in the clubhouse,
-- and a manager who does not open the app on a Tuesday never sees it. So when
-- the Special is published, every seat that played gets one line about its
-- own week — the result first, then the thing worth arguing about: the bench
-- decision that cost the game, the place gained or lost in the table, the
-- streak — and the tap lands on /recap/<week>, where the whole column is.
--
-- Two decisions. The line is its own function, callable by a manager, so the
-- sentence on the recap page is the sentence that was pushed and the words
-- can be tested without a device. And the push is sent from ff_publish_recap
-- rather than from a trigger on league_recaps: publish is already the one
-- idempotent writer, with the recap row as its lock, so "one line per manager
-- per week" follows from "one recap per week" for free — and a repair insert
-- of an old recap can never buzz twelve phones about a week in October.
-- ============================================================================

-- ----------------------------------------------------------------- words --

create or replace function public.ff_ordinal(p_n integer)
returns text
language sql
immutable
as $$
  select p_n::text || case
    when p_n % 100 between 11 and 13 then 'th'
    when p_n % 10 = 1 then 'st'
    when p_n % 10 = 2 then 'nd'
    when p_n % 10 = 3 then 'rd'
    else 'th' end
$$;

-- ------------------------------------------------------------- the line --

create or replace function public.ff_personal_recap_line(p_league_id uuid, p_week integer, p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_m       record;
  v_opp     text;
  v_title   text;
  v_clauses text[] := '{}';
  v_bench   record;
  v_now     integer;
  v_before  integer;
  v_streak  integer := 0;
  v_r       record;
  v_word    text;
  v_body    text;
begin
  -- Readable by the league; the publisher calls it with no session.
  if v_uid is not null
     and not public.ff_is_member(p_league_id)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  select m.week,
         case when m.home_team_id = p_team_id then m.home_points else m.away_points end as pf,
         case when m.home_team_id = p_team_id then m.away_points else m.home_points end as pa,
         case when m.home_team_id = p_team_id then m.away_team_id else m.home_team_id end as opp_id
    into v_m
    from matchups m
   where m.league_id = p_league_id and m.week = p_week
     and p_team_id in (m.home_team_id, m.away_team_id);
  if not found or v_m.pf + v_m.pa = 0 then return null; end if;

  select public.ff_who(t.manager_name, t.name) into v_opp from teams t where t.id = v_m.opp_id;

  -- The result, always first.
  if v_m.pf > v_m.pa then
    v_title := format('You beat %s by %s.', v_opp, to_char(v_m.pf - v_m.pa, 'FM999990.0'));
  elsif v_m.pf < v_m.pa then
    v_title := format('Lost by %s to %s.', to_char(v_m.pa - v_m.pf, 'FM999990.0'), v_opp);
  else
    v_title := format('Tied %s at %s.', v_opp, to_char(v_m.pf, 'FM999990.0'));
  end if;

  -- The bench decision that cost the game: a loss where the best reserve beat
  -- the worst starter by more than the margin. The Special's own test.
  if v_m.pf < v_m.pa then
    select b.full_name, b.points into v_bench
      from (select rp.full_name, rp.points
              from roster_points rp
             where rp.team_id = p_team_id and rp.week = p_week and rp.slot = 'BN'
             order by rp.points desc, rp.full_name limit 1) b
     where b.points - (select min(rp.points) from roster_points rp
                        where rp.team_id = p_team_id and rp.week = p_week and rp.slot <> 'BN')
           > (v_m.pa - v_m.pf);
    if found then
      v_clauses := v_clauses || format('%s on your bench had %s.', v_bench.full_name, to_char(v_bench.points, 'FM999990.0'));
    end if;
  end if;

  -- The table, this week against last, in the standings' own order: wins with
  -- a tie worth half, then points.
  with sides as (
    select m.week, s.team_id, s.pf, s.pa
      from matchups m
      cross join lateral (values (m.home_team_id, m.home_points, m.away_points),
                                 (m.away_team_id, m.away_points, m.home_points)) as s(team_id, pf, pa)
     where m.league_id = p_league_id and m.week <= p_week and m.home_points + m.away_points > 0
  ),
  tbl as (
    select t.id,
           rank() over (order by count(*) filter (where g.pf > g.pa)
                                 + count(*) filter (where g.pf = g.pa) / 2.0 desc,
                                 coalesce(sum(g.pf), 0) desc, t.name) as now_rank,
           rank() over (order by count(*) filter (where g.pf > g.pa and g.week < p_week)
                                 + count(*) filter (where g.pf = g.pa and g.week < p_week) / 2.0 desc,
                                 coalesce(sum(g.pf) filter (where g.week < p_week), 0) desc, t.name) as before_rank
      from teams t left join sides g on g.team_id = t.id
     where t.league_id = p_league_id
     group by t.id, t.name
  )
  select now_rank, before_rank into v_now, v_before from tbl where id = p_team_id;

  if p_week > 1 and v_now is distinct from v_before then
    v_clauses := v_clauses || format('%s to %s.', case when v_now < v_before then 'Up' else 'Down' end, public.ff_ordinal(v_now));
  end if;

  -- The streak: results of this week's kind, counting back from it.
  if v_m.pf <> v_m.pa then
    for v_r in
      select case when m.home_team_id = p_team_id then sign(m.home_points - m.away_points)
                  else sign(m.away_points - m.home_points) end as s
        from matchups m
       where m.league_id = p_league_id and m.week <= p_week and m.home_points + m.away_points > 0
         and p_team_id in (m.home_team_id, m.away_team_id)
       order by m.week desc
    loop
      exit when v_r.s <> sign(v_m.pf - v_m.pa);
      v_streak := v_streak + 1;
    end loop;

    if v_streak >= 3 or (v_streak = 2 and array_length(v_clauses, 1) is null) then
      v_word := case v_streak when 2 then 'Two' when 3 then 'Three' when 4 then 'Four'
                              when 5 then 'Five' when 6 then 'Six' else v_streak::text end;
      v_clauses := v_clauses || case when v_m.pf > v_m.pa
        then format('%s straight.', v_word)
        else format('%s losses in a row.', v_word) end;
    end if;
  end if;

  -- The title is the result; the body is the next two things worth saying.
  v_body := array_to_string(v_clauses[1:2], ' ');
  if v_body is null or v_body = '' then
    v_body := 'The Weekly Special is up. Tap to read the week.';
  end if;

  return jsonb_build_object('title', v_title, 'body', v_body);
end $$;

-- ------------------------------------------------------------- the push --

-- Every seat that played: the owner and any co-owner. Returns how many lines
-- were owed — ff_notify itself stays silent for a seat with no device or the
-- switch off.
create or replace function public.ff_recap_notify(p_league_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_t record; v_u record; v_line jsonb; v_n integer := 0;
begin
  for v_t in select t.id, t.owner_id from teams t where t.league_id = p_league_id loop
    v_line := public.ff_personal_recap_line(p_league_id, p_week, v_t.id);
    if v_line is null then continue; end if;
    for v_u in
      select v_t.owner_id as user_id where v_t.owner_id is not null
      union
      select co.user_id from team_co_owners co where co.team_id = v_t.id
    loop
      if public.ff_notify(v_u.user_id, 'recap', v_line->>'title', v_line->>'body', '/recap/' || p_week) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

-- Restated from 20260904022842 with one addition after the post: the lines go
-- out, guarded, so a bad sentence can never un-post the Special.
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
  v_sent  integer := 0;
begin
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

  begin
    v_sent := public.ff_recap_notify(p_league_id, p_week);
  exception when others then
    raise notice 'recap lines for week % not sent: %', p_week, sqlerrm;
  end;

  return jsonb_build_object('week', p_week, 'posted', true, 'message_id', v_msg, 'body', v_body, 'notified', v_sent);
end;
$fn$;

-- ------------------------------------------------------------- the grants --
revoke execute on function public.ff_ordinal(integer)                                from public, anon;
revoke execute on function public.ff_personal_recap_line(uuid, integer, uuid)        from public, anon;
revoke execute on function public.ff_recap_notify(uuid, integer)                     from public, anon, authenticated;
revoke execute on function public.ff_publish_recap(uuid, integer)                    from public, anon;

grant execute on function public.ff_ordinal(integer)                                 to authenticated, service_role;
grant execute on function public.ff_personal_recap_line(uuid, integer, uuid)         to authenticated, service_role;
grant execute on function public.ff_recap_notify(uuid, integer)                      to service_role;
grant execute on function public.ff_publish_recap(uuid, integer)                     to authenticated, service_role;
