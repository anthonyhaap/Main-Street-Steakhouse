-- ============================================================================
-- Publish nfl_games to realtime.
--
-- The game center and the Sunday board both subscribe to `nfl_games` as a
-- signal to refetch, and neither ever heard from it: the table was never
-- added to the `supabase_realtime` publication, so a change to it sent
-- nothing. Most of the time a score also moves `matchups` or `rosters`, which
-- are published, and that covered for it. What it did not cover is the part
-- of a game that is not a fantasy point — the clock, the score of a game
-- none of ours are in, and now who has the ball and whether that drive is in
-- the red zone. Those waited for the fifteen-second poll.
--
-- Realtime reads through RLS, and `nfl_games` is already readable by every
-- member, so publishing it shows nobody a row they could not already select.
-- Sixteen rows, rewritten every two minutes during a game window, is nothing
-- for the socket to carry.
--
-- Idempotent, the same way 20260917025956_pickem publishes its table.
-- ============================================================================

do $$ begin alter publication supabase_realtime add table public.nfl_games;
exception when duplicate_object then null; end $$;
