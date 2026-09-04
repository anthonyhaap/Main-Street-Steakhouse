-- A full autopick dry run produced 12 rosters with ZERO kickers and 2 defenses.
-- ADP alone never surfaces K/DST inside 180 picks, so a team that autopicks its
-- whole draft would field an illegal lineup in week 1.
--
-- Fix: once a team has only as many picks left as it has unfilled REQUIRED
-- starting slots, restrict candidates to those slots. Pure ADP until the
-- endgame, then need takes over -- which is what a human does anyway.

-- Which required starting positions is this team still missing?
create or replace function ff_roster_needs(p_draft_id uuid, p_team_id uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_league uuid; v_slots jsonb; v_needs text[] := '{}';
  v_pos text; v_req int; v_have int; v_flex_req int; v_flex_have int; i int;
begin
  select d.league_id into v_league from drafts d where d.id = p_draft_id;
  select roster_slots into v_slots from leagues where id = v_league;

  foreach v_pos in array array['QB','RB','WR','TE','K','DST'] loop
    select count(*) into v_req from jsonb_array_elements_text(v_slots) s where s = v_pos;
    select count(*) into v_have
      from draft_picks dp join players p on p.id = dp.player_id
     where dp.draft_id = p_draft_id and dp.team_id = p_team_id and p.position = v_pos;
    for i in 1..greatest(0, v_req - v_have) loop
      v_needs := v_needs || v_pos;
    end loop;
  end loop;

  -- FLEX: satisfied by any RB/WR/TE beyond the dedicated requirements
  select count(*) into v_flex_req from jsonb_array_elements_text(v_slots) s where s = 'FLEX';
  if v_flex_req > 0 then
    select count(*) into v_flex_have
      from draft_picks dp join players p on p.id = dp.player_id
     where dp.draft_id = p_draft_id and dp.team_id = p_team_id
       and p.position in ('RB','WR','TE');
    select count(*) into v_req from jsonb_array_elements_text(v_slots) s
     where s in ('RB','WR','TE');
    for i in 1..greatest(0, v_flex_req - greatest(0, v_flex_have - v_req)) loop
      v_needs := v_needs || 'FLEX';
    end loop;
  end if;

  return v_needs;
end; $$;

create or replace function ff_best_available(p_draft_id uuid, p_team_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_league uuid; v_caps jsonb; v_pick uuid;
  v_needs text[]; v_rounds int; v_made int; v_remaining int;
  v_forced text[];
begin
  select league_id, rounds into v_league, v_rounds from drafts where id = p_draft_id;
  select coalesce(settings->'autopick_caps',
                  '{"QB":2,"RB":6,"WR":6,"TE":2,"K":1,"DST":1}'::jsonb)
    into v_caps from leagues where id = v_league;

  -- 1. the team's own queue always wins
  select q.player_id into v_pick
  from draft_queue q
  where q.team_id = p_team_id
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = q.player_id)
  order by q.rank limit 1;
  if v_pick is not null then return v_pick; end if;

  select count(*) into v_made from draft_picks
   where draft_id = p_draft_id and team_id = p_team_id;
  v_remaining := v_rounds - v_made;
  v_needs     := ff_roster_needs(p_draft_id, p_team_id);

  -- 2. endgame: out of slack, so only positions that fill a required slot
  if array_length(v_needs,1) is not null and v_remaining <= array_length(v_needs,1) then
    v_forced := array(
      select distinct case when n = 'FLEX' then null else n end
      from unnest(v_needs) n where n <> 'FLEX');
    if array_length(v_forced,1) is null then
      v_forced := array['RB','WR','TE'];   -- only FLEX left
    end if;

    select p.id into v_pick
    from players p
    left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
    where p.status = 'ACT' and p.position = any(v_forced)
      and not exists (select 1 from draft_picks dp
                      where dp.draft_id = p_draft_id and dp.player_id = p.id)
    order by a.adp nulls last, p.full_name limit 1;
    if v_pick is not null then return v_pick; end if;
  end if;

  -- 3. otherwise best ADP at a position the team is not full at
  select p.id into v_pick
  from players p
  join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
  where p.status = 'ACT'
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = p.id)
    and (select count(*) from draft_picks dp2
         join players p2 on p2.id = dp2.player_id
         where dp2.draft_id = p_draft_id and dp2.team_id = p_team_id
           and p2.position = p.position) < coalesce((v_caps->>p.position)::int, 99)
  order by a.adp limit 1;
  if v_pick is not null then return v_pick; end if;

  -- 4. last resort
  select p.id into v_pick
  from players p
  left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr'
  where p.status = 'ACT'
    and not exists (select 1 from draft_picks dp
                    where dp.draft_id = p_draft_id and dp.player_id = p.id)
  order by a.adp nulls last, p.full_name limit 1;
  return v_pick;
end; $$;