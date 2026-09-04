-- Commissioner write API. The UI changes WHO can call these; authorization
-- itself stays here, in security definer functions behind ff_assert_commissioner.

-- Preview a scoring change before committing it: what would actually move?
create or replace function ff_preview_scoring_change(
  p_league_id uuid, p_new_rules jsonb, p_from_week int default 1, p_season int default 2025
) returns table (
  week int, players_changed int, biggest_mover text,
  biggest_delta numeric, avg_abs_delta numeric
)
language sql stable security definer set search_path = public as $$
  with d as (
    select sl.week,
           p.full_name,
           ff_score(sl.stats, p_new_rules)
             - ff_score(sl.stats, ff_rules_for_week(p_league_id, sl.week)) as delta
    from player_stat_lines sl
    join players p on p.id = sl.player_id
    where sl.season = p_season and sl.week >= p_from_week
  ), ranked as (
    select *, row_number() over (partition by week order by abs(delta) desc) rn from d
  )
  select week,
         count(*) filter (where abs(delta) > 0.001)::int,
         max(full_name) filter (where rn = 1),
         round(max(delta) filter (where rn = 1), 2),
         round(avg(abs(delta)), 3)
  from ranked group by week order by week
$$;

-- Versioned scoring write. Prospective by default: pass the week it starts from.
create or replace function ff_set_scoring_rules(
  p_league_id uuid, p_rules jsonb, p_effective_from_week int default 1, p_note text default null
) returns league_scoring_rules
language plpgsql security definer set search_path = public as $$
declare v_row league_scoring_rules%rowtype;
begin
  perform ff_assert_commissioner(p_league_id);
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'rules must be a JSON object';
  end if;

  insert into league_scoring_rules (league_id, effective_from_week, rules, note, created_by)
  values (p_league_id, p_effective_from_week, p_rules, p_note, auth.uid())
  on conflict (league_id, effective_from_week) do update
    set rules = excluded.rules, note = excluded.note,
        created_by = excluded.created_by, created_at = now()
  returning * into v_row;

  -- keep the convenience mirror pointing at the latest ruleset
  update leagues set scoring_rules = (
    select rules from league_scoring_rules
    where league_id = p_league_id order by effective_from_week desc limit 1
  ) where id = p_league_id;

  return v_row;
end; $$;

create or replace function ff_update_league(
  p_league_id uuid, p_name text default null,
  p_roster_slots jsonb default null, p_settings jsonb default null
) returns leagues
language plpgsql security definer set search_path = public as $$
declare v leagues%rowtype;
begin
  perform ff_assert_commissioner(p_league_id);
  update leagues set
    name         = coalesce(p_name, name),
    roster_slots = coalesce(p_roster_slots, roster_slots),
    settings     = case when p_settings is null then settings else settings || p_settings end
  where id = p_league_id returning * into v;
  if not found then raise exception 'league % not found', p_league_id; end if;
  return v;
end; $$;

create or replace function ff_update_team(
  p_team_id uuid, p_name text default null, p_draft_slot int default null
) returns teams
language plpgsql security definer set search_path = public as $$
declare v teams%rowtype; v_league uuid;
begin
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team % not found', p_team_id; end if;
  perform ff_assert_commissioner(v_league);

  -- draft slots are unique per league; swap rather than collide
  if p_draft_slot is not null then
    update teams set draft_slot = (select draft_slot from teams where id = p_team_id)
     where league_id = v_league and draft_slot = p_draft_slot and id <> p_team_id;
  end if;

  update teams set name = coalesce(p_name, name),
                   draft_slot = coalesce(p_draft_slot, draft_slot)
  where id = p_team_id returning * into v;
  return v;
end; $$;

create or replace function ff_update_draft(
  p_draft_id uuid, p_rounds int default null, p_pick_seconds int default null
) returns drafts
language plpgsql security definer set search_path = public as $$
declare v drafts%rowtype; v_league uuid;
begin
  select league_id into v_league from drafts where id = p_draft_id;
  if v_league is null then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_league);
  if exists (select 1 from draft_picks where draft_id = p_draft_id) and p_rounds is not null then
    raise exception 'cannot change round count once picks have been made';
  end if;
  update drafts set rounds = coalesce(p_rounds, rounds),
                    pick_seconds = coalesce(p_pick_seconds, pick_seconds)
  where id = p_draft_id returning * into v;
  return v;
end; $$;

-- Randomise draft order. Refuses once the draft has started.
create or replace function ff_randomize_draft_order(p_league_id uuid)
returns setof teams language plpgsql security definer set search_path = public as $$
begin
  perform ff_assert_commissioner(p_league_id);
  if exists (select 1 from drafts d join draft_picks dp on dp.draft_id = d.id
             where d.league_id = p_league_id) then
    raise exception 'draft has already started';
  end if;
  with shuffled as (
    select id, row_number() over (order by md5(id::text || clock_timestamp()::text)) as slot
    from teams where league_id = p_league_id
  )
  update teams t set draft_slot = null from shuffled s where t.id = s.id;
  with shuffled as (
    select id, row_number() over (order by md5(id::text || clock_timestamp()::text)) as slot
    from teams where league_id = p_league_id
  )
  update teams t set draft_slot = s.slot from shuffled s where t.id = s.id;
  return query select * from teams where league_id = p_league_id order by draft_slot;
end; $$;

revoke execute on function ff_set_scoring_rules(uuid,jsonb,int,text) from anon;
revoke execute on function ff_update_league(uuid,text,jsonb,jsonb) from anon;
revoke execute on function ff_update_team(uuid,text,int) from anon;
revoke execute on function ff_update_draft(uuid,int,int) from anon;
revoke execute on function ff_randomize_draft_order(uuid) from anon;