-- ============================================================================
-- Commissioner-set draft order, alongside the existing randomizer.
--
-- ff_randomize_draft_order already shuffles teams.draft_slot before the draft
-- starts. This adds the other half: the commissioner hands in the exact order
-- they want -- snake seed, a house tradition, whatever -- as an array of team
-- ids, and slot 1 goes to the first one. Same guards as the randomizer:
-- commissioner only, and only before the first pick is made.
-- ============================================================================

create or replace function public.ff_set_draft_order(p_league_id uuid, p_team_ids uuid[])
returns setof teams
language plpgsql
security definer
set search_path = public
as $$
declare v_expected int; v_given int;
begin
  perform ff_assert_commissioner(p_league_id);

  if exists (select 1 from drafts d join draft_picks dp on dp.draft_id = d.id
             where d.league_id = p_league_id) then
    raise exception 'draft has already started';
  end if;

  select count(*) into v_expected from teams where league_id = p_league_id;
  select count(distinct t) into v_given from unnest(p_team_ids) as t;

  if v_given <> v_expected then
    raise exception 'must name every team in the league exactly once';
  end if;

  if exists (
    select 1 from unnest(p_team_ids) as t
    where t not in (select id from teams where league_id = p_league_id)
  ) then
    raise exception 'unknown team in draft order';
  end if;

  -- null first, same as the randomizer: draft_slot is unique per league, so
  -- writing the new values directly can collide with the old ones mid-update.
  update teams set draft_slot = null where league_id = p_league_id;
  with ordered as (
    select t as id, ord as slot from unnest(p_team_ids) with ordinality as u(t, ord)
  )
  update teams tm set draft_slot = o.slot from ordered o where tm.id = o.id;

  return query select * from teams where league_id = p_league_id order by draft_slot;
end $$;

revoke all on function public.ff_set_draft_order(uuid, uuid[]) from public, anon;
grant execute on function public.ff_set_draft_order(uuid, uuid[]) to authenticated;

comment on function public.ff_set_draft_order(uuid, uuid[]) is
  'Commissioner only, setup only. Sets teams.draft_slot from the order of p_team_ids -- first element gets slot 1. Must name every team in the league exactly once.';
