-- Server clock: draft timers must never trust the client's system clock.
create or replace function public.ff_now() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.ff_now() to authenticated;

-- draft_pool gains bye week and positional rank.
drop view if exists public.draft_pool;
create view public.draft_pool with (security_invoker = true) as
select p.id, p.full_name, p.position, p.nfl_team, p.status,
       a.adp, a.overall_rank, p.bye_week,
       rank() over (partition by p.position
                    order by coalesce(a.overall_rank, 9999), p.full_name) as position_rank
from players p
left join player_adp a on a.player_id = p.id and a.season = 2026 and a.format = 'ppr' and a.teams = 12
where p.status = 'ACT' and p.sleeper_id is not null;

-- Realtime coverage for the rest of the app.
do $$
declare t text;
begin
  foreach t in array array['teams','rosters','matchups','draft_queue'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
