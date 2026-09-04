-- Autopick. Order of preference:
--   1. the team's own queue (they told us what they want)
--   2. best available by ADP at a position they aren't already full at
--   3. best available by ADP, full stop
--
-- Position caps are what stop autopick handing someone a kicker in round 1:
-- ADP already sorts K and DST late, and the cap stops a second one ever landing.
update leagues set settings = settings || jsonb_build_object(
  'autopick_caps', jsonb_build_object('QB',2,'RB',6,'WR',6,'TE',2,'K',1,'DST',1)
) where settings->'autopick_caps' is null;

create or replace function ff_best_available(p_draft_id uuid, p_team_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_league uuid; v_caps jsonb; v_pick uuid;
begin
  select league_id into v_league from drafts where id = p_draft_id;
  select coalesce(settings->'autopick_caps',
                  '{"QB":2,"RB":6,"WR":6,"TE":2,"K":1,"DST":1}'::jsonb)
    into v_caps from leagues where id = v_league;

  -- 1. the team's queue
  select q.player_id into v_pick
  from draft_queue q
  join players p on p.id = q.player_id
  where q.team_id = p_team_id
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = q.player_id)
  order by q.rank limit 1;
  if v_pick is not null then return v_pick; end if;

  -- 2. best ADP at a position this team is not full at
  select p.id into v_pick
  from players p
  join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
  where p.status = 'ACT'
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = p.id)
    and (
      select count(*) from draft_picks dp2
      join players p2 on p2.id = dp2.player_id
      where dp2.draft_id = p_draft_id and dp2.team_id = p_team_id and p2.position = p.position
    ) < coalesce((v_caps->>p.position)::int, 99)
  order by a.adp limit 1;
  if v_pick is not null then return v_pick; end if;

  -- 3. anyone left, best ADP first, then alphabetical as a last resort
  select p.id into v_pick
  from players p
  left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
  where p.status = 'ACT'
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = p.id)
  order by a.adp nulls last, p.full_name limit 1;

  return v_pick;
end; $$;

create or replace function ff_autopick(p_draft_id uuid)
returns draft_picks language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_player uuid;
begin
  v_team   := ff_team_on_clock(p_draft_id);
  v_player := ff_best_available(p_draft_id, v_team);
  if v_player is null then raise exception 'no players available to autopick'; end if;
  return ff_make_pick(p_draft_id, v_player, v_team, null, true, false);
end; $$;

-- The tick. Runs on a schedule; picks for anyone whose clock has expired.
-- Loops because a whole room can time out at once (everyone asleep at 1am).
create or replace function ff_tick_drafts()
returns int language plpgsql security definer set search_path = public as $$
declare v_draft record; v_made int := 0; v_guard int := 0;
begin
  for v_draft in
    select id from drafts
    where status = 'active' and pick_deadline is not null and pick_deadline < now()
  loop
    v_guard := 0;
    while v_guard < 50 loop
      begin
        perform ff_autopick(v_draft.id);
        v_made := v_made + 1;
      exception when others then
        insert into ingest_log (source, event, detail)
        values ('draft','autopick_failed',
                jsonb_build_object('draft', v_draft.id, 'error', sqlerrm));
        exit;
      end;
      v_guard := v_guard + 1;
      exit when not exists (
        select 1 from drafts
        where id = v_draft.id and status = 'active'
          and pick_deadline is not null and pick_deadline < now());
    end loop;
  end loop;

  if v_made > 0 then
    insert into ingest_log (source, event, detail)
    values ('draft','autopicked', jsonb_build_object('picks', v_made));
  end if;
  return v_made;
end; $$;

revoke execute on function ff_tick_drafts() from anon, authenticated;

-- Queue management for managers
create or replace function ff_set_queue(p_team_id uuid, p_player_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is not null and not exists (
    select 1 from teams t join leagues l on l.id = t.league_id
    where t.id = p_team_id and (t.owner_id = auth.uid() or l.commissioner_id = auth.uid())
  ) then
    raise exception 'not your team';
  end if;

  delete from draft_queue where team_id = p_team_id;
  insert into draft_queue (team_id, player_id, rank)
  select p_team_id, pid, ord from unnest(p_player_ids) with ordinality as t(pid, ord);
  get diagnostics v_n = row_count;
  return v_n;
end; $$;