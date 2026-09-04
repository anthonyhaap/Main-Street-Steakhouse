-- Private-league posture: signed-in users can READ everything; nobody writes
-- through the table API. Every mutation goes through a SECURITY DEFINER
-- function, which is also where authorization lives.

alter table nfl_teams        enable row level security;
alter table players          enable row level security;
alter table player_id_map    enable row level security;
alter table player_adp       enable row level security;
alter table leagues          enable row level security;
alter table teams            enable row level security;
alter table drafts           enable row level security;
alter table draft_picks      enable row level security;
alter table rosters          enable row level security;
alter table matchups         enable row level security;
alter table nfl_games        enable row level security;
alter table player_stat_lines enable row level security;
alter table ingest_log       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['nfl_teams','players','player_id_map','player_adp','leagues','teams',
                           'drafts','draft_picks','rosters','matchups','nfl_games','player_stat_lines']
  loop
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- ingest_log is operational noise; keep it out of the client entirely.
revoke all on ingest_log from anon, authenticated;

-- Commissioner gate. auth.uid() is null for the service role and the SQL
-- editor, which is intentional: those paths are already trusted. A league with
-- no commissioner yet is open so the first login can claim it.
create or replace function ff_assert_commissioner(p_league_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (
    select 1 from leagues
    where id = p_league_id
      and (commissioner_id is null or commissioner_id = auth.uid())
  ) then
    raise exception 'not authorized: commissioner only';
  end if;
end; $$;

-- Re-declare the mutating functions with the gate in place.
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
  if p_force then perform ff_assert_commissioner(v_draft.league_id); end if;
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
  perform ff_assert_commissioner(v_draft.league_id);
  if v_draft.status <> 'active' then return v_draft; end if;
  update drafts set status='paused',
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
  perform ff_assert_commissioner(v_draft.league_id);
  if v_draft.status not in ('paused','setup') then return v_draft; end if;
  update drafts set status='active', started_at = coalesce(started_at, now()),
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
  perform ff_assert_commissioner(v_draft.league_id);
  select * into v_pick from draft_picks where draft_id = p_draft_id order by pick_number desc limit 1;
  if not found then raise exception 'no picks to undo'; end if;
  delete from draft_picks where id = v_pick.id;
  update drafts set current_pick = v_pick.pick_number,
         status = case when status='complete' then 'paused'::draft_status else status end,
         completed_at = null,
         pick_deadline = case when status='active' then now() + make_interval(secs => pick_seconds) else null end
   where id = p_draft_id;
  return v_pick;
end; $$;

create or replace function ff_start_draft(p_draft_id uuid)
returns drafts language plpgsql security definer set search_path = public as $$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);
  update drafts set status='active', started_at = coalesce(started_at, now()),
         pick_deadline = now() + make_interval(secs => pick_seconds), remaining_ms = null
   where id = p_draft_id returning * into v_draft;
  return v_draft;
end; $$;

-- Claim an unowned league as commissioner (first login bootstrap).
create or replace function ff_claim_commissioner(p_league_id uuid)
returns leagues language plpgsql security definer set search_path = public as $$
declare v_league leagues%rowtype;
begin
  update leagues set commissioner_id = auth.uid()
   where id = p_league_id and commissioner_id is null
  returning * into v_league;
  if not found then select * into v_league from leagues where id = p_league_id; end if;
  return v_league;
end; $$;

revoke execute on function ff_make_pick(uuid,uuid,uuid,uuid,boolean,boolean) from anon;
revoke execute on function ff_pause_draft(uuid) from anon;
revoke execute on function ff_resume_draft(uuid) from anon;
revoke execute on function ff_undo_last_pick(uuid) from anon;
revoke execute on function ff_start_draft(uuid) from anon;
revoke execute on function ff_claim_commissioner(uuid) from anon;
revoke execute on function ff_load_nflverse_players(int, text) from anon, authenticated;