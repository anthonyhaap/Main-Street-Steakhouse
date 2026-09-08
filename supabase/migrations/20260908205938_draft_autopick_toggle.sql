-- Autopick: pin the schedule that runs it, and let a manager ask for it.
--
-- Two things, because they are the same thing from opposite ends. Autopick is
-- what happens when nobody is there to pick; this makes sure it will still be
-- running on draft night, and gives a manager a way to choose it on purpose.

-- ---------------------------------------------------------------- the tick --
-- `ff_tick_drafts` has existed since 20260809030659 and its own comment says
-- "runs on a schedule" — but no migration ever scheduled it. The job was
-- created by hand in the dashboard, so it exists on this project and nowhere
-- else: rebuild the database from these files (the replay harness, a restore,
-- a new environment) and every draft function comes back with nothing calling
-- them. Clocks would expire and simply sit there, which is the one failure
-- that looks like nothing being wrong.
--
-- Every other job is scheduled in the migration that needs it. This one now is
-- too. cron.schedule upserts on (username, jobname) and the live job is jobid 1
-- owned by postgres, so this updates that row rather than adding a second job
-- ticking the same drafts.
select cron.schedule('draft-tick', '5 seconds', 'select public.ff_tick_drafts()');

-- --------------------------------------------------------------- the toggle --
-- Sitting out a pick and sitting out a draft are different requests. The clock
-- covers the first: miss it and autopick takes your queue, or the best player
-- left. There was no way to say the second — "I am at work, do the whole thing
-- for me" — except to let ninety seconds burn on every one of your fifteen
-- picks, which holds up eleven other people for however long you are gone.
alter table public.teams
  add column if not exists auto_draft boolean not null default false;

comment on column public.teams.auto_draft is
  'Manager has asked to be drafted for: ff_tick_drafts picks for this team the moment it is on the clock, without waiting out the pick clock. Follows the queue first, exactly as a timeout would.';

create or replace function public.ff_set_auto_draft(p_team_id uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  -- Same guard as ff_set_queue: your own team, or the commissioner's for any
  -- of them. auth.uid() is null for the service role, which is how the tick
  -- and the tests reach it.
  if auth.uid() is not null and not exists (
    select 1 from teams t join leagues l on l.id = t.league_id
    where t.id = p_team_id and (t.owner_id = auth.uid() or l.commissioner_id = auth.uid())
  ) then
    raise exception 'not your team';
  end if;

  update teams set auto_draft = coalesce(p_on, false) where id = p_team_id;
  return coalesce(p_on, false);
end $fn$;

comment on function public.ff_set_auto_draft(uuid, boolean) is
  'Turn auto draft on or off for one team. Owner or commissioner only.';

revoke execute on function public.ff_set_auto_draft(uuid, boolean) from public, anon;
grant execute on function public.ff_set_auto_draft(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------ the tick, revised --
-- Unchanged except for what counts as due. It was "this draft's clock has
-- expired"; it is now that, or "the team on the clock asked to be drafted
-- for". Everything downstream is the same function that has always run:
-- ff_autopick -> ff_best_available -> queue first, then ADP, then need.
--
-- The inner loop matters more than it did. A timeout picks once and hands the
-- next manager a fresh ninety seconds, so the loop exited immediately; a room
-- where four people in a row are on auto should not take six minutes to get
-- through them, so it now keeps going while the next team is also on auto and
-- stops the moment it reaches somebody who is playing. The guard of 50 is the
-- same backstop it always was.
create or replace function public.ff_tick_drafts()
returns int language plpgsql security definer set search_path = public as $fn$
declare v_draft record; v_made int := 0; v_guard int := 0; v_due boolean;
begin
  for v_draft in
    select d.id from drafts d
    where d.status = 'active'
      and ((d.pick_deadline is not null and d.pick_deadline < now())
           or exists (select 1 from teams t
                       where t.id = ff_team_on_clock(d.id) and t.auto_draft))
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

      select (d.status = 'active'
              and ((d.pick_deadline is not null and d.pick_deadline < now())
                   or exists (select 1 from teams t
                               where t.id = ff_team_on_clock(d.id) and t.auto_draft)))
        into v_due
      from drafts d where d.id = v_draft.id;
      exit when not coalesce(v_due, false);
    end loop;
  end loop;

  if v_made > 0 then
    insert into ingest_log (source, event, detail)
    values ('draft','autopicked', jsonb_build_object('picks', v_made));
  end if;
  return v_made;
end $fn$;

comment on function public.ff_tick_drafts() is
  'Every 5s: picks for any team whose clock has expired, or who has auto_draft on. Service role only — a manager cannot advance the board by calling it.';

revoke execute on function public.ff_tick_drafts() from public, anon, authenticated;
