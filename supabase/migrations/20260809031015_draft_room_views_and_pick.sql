-- The draft board a client actually needs: available players with ADP, and a
-- pick entry point a normal manager (not just the commissioner) can call.

create or replace view draft_pool as
select p.id, p.full_name, p.position, p.nfl_team, p.status,
       a.adp, a.overall_rank
from players p
left join player_adp a
  on a.player_id = p.id and a.season = 2026 and a.format = 'ppr' and a.teams = 12
where p.status = 'ACT';

-- A manager picking for their own team. Authorization by team ownership;
-- the commissioner keeps the forced path in ff_make_pick.
create or replace function ff_pick_for_my_team(p_draft_id uuid, p_player_id uuid)
returns draft_picks language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_onclock uuid; v_league uuid;
begin
  select league_id into v_league from drafts where id = p_draft_id;
  if v_league is null then raise exception 'draft not found'; end if;

  v_onclock := ff_team_on_clock(p_draft_id);

  if auth.uid() is not null then
    select id into v_team from teams
     where league_id = v_league and owner_id = auth.uid();
    -- commissioner may pick for whoever is on the clock
    if v_team is null and exists (
      select 1 from leagues where id = v_league and commissioner_id = auth.uid()
    ) then
      v_team := v_onclock;
    end if;
    if v_team is null then raise exception 'you do not own a team in this league'; end if;
    if v_team <> v_onclock then raise exception 'not your pick'; end if;
  else
    v_team := v_onclock;
  end if;

  return ff_make_pick(p_draft_id, p_player_id, v_team, auth.uid(), false, false);
end; $$;

revoke execute on function ff_pick_for_my_team(uuid, uuid) from anon;
revoke execute on function ff_set_queue(uuid, uuid[]) from anon;