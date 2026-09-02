-- ============================================================================
-- Schedules for the three feeds added alongside the live stats poller.
--
-- Cadence is chosen by how fast each source actually changes, not by how often
-- we could ask:
--
--   wire-refresh   15 min — practice reports and headlines land through the
--                           day; a quarter hour is inside anyone's patience and
--                           still only ~100 fetches a day of a 9 MB feed.
--   projections     6 h   — Sleeper revises the week's numbers as the injury
--                           picture settles. Four times a day catches every
--                           revision that matters and none of the noise.
--   player-pool    daily  — bio, jersey and depth chart move on transaction
--                           days, not hourly. Overnight is soon enough, and it
--                           is a 5 MB fetch.
--
-- All three are wrapped by functions that swallow their own failures, so a bad
-- day at ESPN shows up in ingest_log and on the commissioner's dashboard rather
-- than as a red cron run.
-- ============================================================================

select cron.schedule('wire-refresh', '*/15 * * * *', 'select public.ff_refresh_wire()');
select cron.schedule('projections',  '35 */6 * * *', 'select public.ff_refresh_projections()');
select cron.schedule('player-pool',  '40 8 * * *',   'select public.ff_load_sleeper_players()');
