create or replace function ff_snake_slot(p_pick int, p_team_count int)
returns int language plpgsql immutable as $$
declare v_round int; v_idx int;
begin
  v_round := ((p_pick - 1) / p_team_count) + 1;
  v_idx   := p_pick - (v_round - 1) * p_team_count;
  if v_round % 2 = 0 then
    return p_team_count - v_idx + 1;
  end if;
  return v_idx;
end; $$;

create or replace function ff_round_for_pick(p_pick int, p_team_count int)
returns int language sql immutable as $$ select ((p_pick - 1) / p_team_count) + 1 $$;

create or replace function ff_team_on_clock(p_draft_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_league uuid; v_count int; v_pick int; v_slot int; v_team uuid;
begin
  select d.league_id, d.current_pick, l.team_count
    into v_league, v_pick, v_count
  from drafts d join leagues l on l.id = d.league_id
  where d.id = p_draft_id;
  if v_league is null then raise exception 'draft % not found', p_draft_id; end if;
  v_slot := ff_snake_slot(v_pick, v_count);
  select id into v_team from teams where league_id = v_league and draft_slot = v_slot;
  return v_team;
end; $$;

create or replace function ff_make_pick(
  p_draft_id uuid, p_player_id uuid, p_team_id uuid default null,
  p_made_by uuid default null, p_autopick boolean default false, p_force boolean default false
) returns draft_picks language plpgsql security definer set search_path = public as $$
declare
  v_draft drafts%rowtype; v_count int; v_team uuid; v_round int; v_total int;
  v_pick draft_picks%rowtype; v_onclock uuid;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  if v_draft.status = 'complete' then raise exception 'draft is already complete'; end if;
  if v_draft.status <> 'active' and not p_force then
    raise exception 'draft is % - only a forced (commissioner) pick is allowed', v_draft.status;
  end if;

  select team_count into v_count from leagues where id = v_draft.league_id;
  v_total   := v_count * v_draft.rounds;
  v_onclock := ff_team_on_clock(p_draft_id);
  v_team    := coalesce(p_team_id, v_onclock);

  if not p_force and p_team_id is not null and p_team_id <> v_onclock then
    raise exception 'team % is not on the clock', p_team_id;
  end if;

  v_round := ff_round_for_pick(v_draft.current_pick, v_count);

  insert into draft_picks (draft_id, pick_number, round, team_id, player_id, is_autopick, made_by)
  values (p_draft_id, v_draft.current_pick, v_round, v_team, p_player_id, p_autopick, p_made_by)
  returning * into v_pick;

  update drafts
     set current_pick  = current_pick + 1,
         pick_deadline = case
                           when current_pick + 1 > v_total then null
                           when status = 'active' then now() + make_interval(secs => pick_seconds)
                           else null end,
         status        = case when current_pick + 1 > v_total then 'complete'::draft_status else status end,
         completed_at  = case when current_pick + 1 > v_total then now() else completed_at end
   where id = p_draft_id;

  return v_pick;
end; $$;

create or replace function ff_pause_draft(p_draft_id uuid)
returns drafts language plpgsql security definer set search_path = public as $$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  if v_draft.status <> 'active' then return v_draft; end if;
  update drafts
     set status = 'paused',
         remaining_ms = greatest(0, (extract(epoch from (pick_deadline - now())) * 1000)::int),
         pick_deadline = null
   where id = p_draft_id returning * into v_draft;
  return v_draft;
end; $$;

create or replace function ff_resume_draft(p_draft_id uuid)
returns drafts language plpgsql security definer set search_path = public as $$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  if v_draft.status not in ('paused', 'setup') then return v_draft; end if;
  update drafts
     set status = 'active',
         started_at = coalesce(started_at, now()),
         pick_deadline = now() + make_interval(
           secs => (coalesce(remaining_ms, pick_seconds * 1000)::double precision / 1000.0)),
         remaining_ms = null
   where id = p_draft_id returning * into v_draft;
  return v_draft;
end; $$;

create or replace function ff_undo_last_pick(p_draft_id uuid)
returns draft_picks language plpgsql security definer set search_path = public as $$
declare v_draft drafts%rowtype; v_pick draft_picks%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  select * into v_pick from draft_picks where draft_id = p_draft_id order by pick_number desc limit 1;
  if not found then raise exception 'no picks to undo'; end if;
  delete from draft_picks where id = v_pick.id;
  update drafts
     set current_pick = v_pick.pick_number,
         status = case when status = 'complete' then 'paused'::draft_status else status end,
         completed_at = null,
         pick_deadline = case when status = 'active' then now() + make_interval(secs => pick_seconds) else null end
   where id = p_draft_id;
  return v_pick;
end; $$;

create or replace function ff_start_draft(p_draft_id uuid)
returns drafts language plpgsql security definer set search_path = public as $$
declare v_draft drafts%rowtype;
begin
  update drafts
     set status = 'active', started_at = coalesce(started_at, now()),
         pick_deadline = now() + make_interval(secs => pick_seconds), remaining_ms = null
   where id = p_draft_id returning * into v_draft;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  return v_draft;
end; $$;

create or replace view draft_board as
select dp.draft_id, dp.pick_number, dp.round, dp.is_autopick, dp.made_at,
       t.id as team_id, t.name as team_name, t.draft_slot,
       p.id as player_id, p.full_name as player_name, p.position, p.nfl_team
from draft_picks dp
join teams t on t.id = dp.team_id
join players p on p.id = dp.player_id;