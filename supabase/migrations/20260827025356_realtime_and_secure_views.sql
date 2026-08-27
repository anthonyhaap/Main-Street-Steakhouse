alter view if exists public.draft_board set (security_invoker = true);
alter view if exists public.standings set (security_invoker = true);
alter view if exists public.draft_pool set (security_invoker = true);
alter view if exists public.roster_points set (security_invoker = true);
do $$ begin alter publication supabase_realtime add table public.draft_picks; exception when duplicate_object or undefined_table then null; end $$;
do $$ begin alter publication supabase_realtime add table public.weekly_scores; exception when duplicate_object or undefined_table then null; end $$;
alter table if exists public.draft_picks replica identity full;
alter table if exists public.weekly_scores replica identity full;
