-- ============================================================================
-- Move the projections refresh off the top of draft night.
--
-- `35 */6 * * *` fires at 00:35, 06:35, 12:35 and 18:35 UTC. The 2026 draft
-- starts 19:30 CDT on 8 September — 00:30 UTC — which put a refresh five
-- minutes after the first pick.
--
-- That run is not a read. Since the season-projection work it also rebuilds
-- player_season_projections, which is the table the draft board is being
-- drafted off, so the numbers on screen would be rewritten while managers are
-- on the clock. The rebuild is an upsert and each week's load has its own
-- exception handler, so the failure mode is soft rather than an empty board —
-- but "soft failure during the one event of the year that cannot be re-run"
-- is not a risk worth carrying for no benefit.
--
-- Offsetting the anchor by two hours keeps the every-six-hours cadence exactly
-- as it was and simply lands the fires elsewhere: 02:35, 08:35, 14:35, 20:35.
-- The hours are written out rather than left as a step so the intent survives
-- being read at speed.
-- ============================================================================

select cron.schedule('projections', '35 2,8,14,20 * * *',
                     'select public.ff_refresh_projections()');
