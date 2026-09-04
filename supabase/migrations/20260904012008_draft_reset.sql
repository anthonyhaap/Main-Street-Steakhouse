-- ============================================================================
-- Reset a draft back to setup.
--
-- Testing a draft means running it, pausing to poke at something, and wanting
-- a clean slate rather than a commissioner-only "undo" pressed a dozen times.
-- ff_reset_draft deletes every pick and puts the draft back exactly where
-- ff_start_draft found it: status 'setup', pick 1, no clock running. Draft
-- order and every team's queue are untouched -- a reset draft still starts
-- from the same seats and the same starred players.
-- ============================================================================

create or replace function public.ff_reset_draft(p_draft_id uuid)
returns drafts
language plpgsql
security definer
set search_path = public
as $$
declare v_draft drafts%rowtype;
begin
  select * into v_draft from drafts where id = p_draft_id for update;
  if not found then raise exception 'draft % not found', p_draft_id; end if;
  perform ff_assert_commissioner(v_draft.league_id);

  delete from draft_picks where draft_id = p_draft_id;

  update drafts set status = 'setup',
         current_pick = 1,
         pick_deadline = null,
         remaining_ms = null,
         started_at = null,
         completed_at = null
   where id = p_draft_id
  returning * into v_draft;

  return v_draft;
end $$;

revoke all on function public.ff_reset_draft(uuid) from public, anon;
grant execute on function public.ff_reset_draft(uuid) to authenticated;

comment on function public.ff_reset_draft(uuid) is
  'Commissioner only. Deletes every pick and returns the draft to setup -- for restarting a test draft. Draft order and team queues are left alone.';
