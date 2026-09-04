"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import { freshness, slateLine, type Scoreboard as Board } from "@/lib/scoreboard";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Scoreboard } from "@/components/Scoreboard";
import { MatchupTalk } from "@/components/matchup/Talk";

/**
 * The Sunday board.
 *
 * Two things it does that the old page did not. It reads one call —
 * `ff_scoreboard` — instead of three tables, so the projections and game
 * states that make a scoreboard worth watching arrive with the scores rather
 * than not at all. And it never blanks: changing week keeps the week you were
 * looking at on screen, dimmed, until the next one lands, because a skeleton
 * where a score used to be reads as an outage.
 *
 * The poll tightens to fifteen seconds while any game is in progress and
 * relaxes to a minute when the slate is quiet — the same contract the
 * briefing uses, for the same reason.
 */
export default function MatchupsPage() {
  const { ready, league } = useSession();
  const [week, setWeek] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    // A clubhouse line about week 11 links here with ?week=11, and the URL
    // saves the round trip. Read from `location` rather than
    // `useSearchParams`, which would opt the whole route out of static
    // rendering for one optional number.
    const asked = Number(new URLSearchParams(window.location.search).get("week"));
    const wanted = Number.isInteger(asked) && asked >= 1
      ? Promise.resolve(asked)
      : supabaseBrowser().rpc("ff_current_week").then(({ data }) => (data as number) ?? 1);
    void wanted.then(setWeek);
  }, [ready]);

  // Fifteen seconds while football is on, a minute when it is not. Realtime
  // still does the real work; this is the net under it. The flag is set where
  // the board lands rather than in an effect watching it — one round trip
  // already knows the answer.
  const [hot, setHot] = useState(false);

  const fetcher = useCallback(async (): Promise<Board> => {
    const { data, error } = await supabaseBrowser()
      .rpc("ff_scoreboard", { p_league_id: LEAGUE_ID, p_week: week });
    if (error) throw new Error(error.message);
    const board = data as Board;
    setHot((board.games?.in_progress ?? 0) > 0);
    return board;
  }, [week]);

  const { data, status, error, refetch } = useLive<Board>(fetcher, {
    // `league_messages` is on the list so a line said about somebody else's
    // game lights up its count on this screen without a reload.
    tables: ["matchups", "rosters", "nfl_games", "league_messages"],
    channel: "scoreboard",
    pollMs: hot ? 15000 : 60000,
    enabled: ready && week !== null,
  });

  // `useLive` refetches on mount, on a row change, on reconnect and on a
  // timer — none of which is "the reader asked for a different week". Its
  // `refetch` keeps one identity across a fetcher change on purpose, so the
  // week has to ask for itself or the new one waits on the next poll.
  useEffect(() => {
    if (ready && week !== null) void refetch();
  }, [week, ready, refetch]);

  // `useLive` holds the last board it fetched, so a week change never blanks
  // the screen. It does mean that for a beat the board on screen is the week
  // you just left — so say so, and dim it, rather than letting a stale score
  // sit under a new week's number.
  const shown = data;
  const stale = !!shown && week !== null && shown.week !== week;

  // Server time, the same as every clock in the app: a phone forty seconds
  // fast must not read a kickoff as already gone. Until the first tick, the
  // board's own timestamp stands in.
  const { serverNow, synced } = useServerClock();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(synced ? serverNow() : Date.now()), 1000);
    return () => clearInterval(id);
  }, [synced, serverNow]);

  const clock = now || (shown ? new Date(shown.now).getTime() : 0);
  const weeks = Number((league?.settings as { regular_season_weeks?: number })?.regular_season_weeks ?? 14) + 3;

  return (
    <>
      <TopBar status={status} />
      <PullToRefresh onRefresh={refetch}>
        <main className="page sb-board" data-width="mid">
          <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
            <div className="segmented" style={{ width: "max-content" }}>
              {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
                <button key={w} className="segmented__opt num" data-on={w === week} onClick={() => setWeek(w)}>
                  {w}
                </button>
              ))}
            </div>
          </div>

          {shown && (
            <div className="sb-slate">
              <p>{stale ? `Loading week ${week}…` : slateLine(shown.games, clock)}</p>
              {/* Provenance, always. A number with a timestamp on it is
                  forgiven; the same number without one is a bug report. */}
              <span className="sb-slate__fresh">
                Scores <b>{freshness(shown.stats_updated_at, clock)}</b>
                {shown.projections_updated_at && ` · projections ${freshness(shown.projections_updated_at, clock)}`}
              </span>
            </div>
          )}

          {!shown && !error && <div className="card"><SkeletonRows n={6} /></div>}

          {!shown && error && (
            <div className="card">
              <div className="empty">
                The board didn&apos;t load.<br />{error}
                <div style={{ marginTop: "var(--s4)" }}>
                  <button className="btn" onClick={() => void refetch()}>Try again</button>
                </div>
              </div>
            </div>
          )}

          {shown && shown.matchups.length === 0 && (
            <div className="card">
              <div className="empty">
                No matchups for week {shown.week} yet.<br />The schedule posts after the draft.
              </div>
            </div>
          )}

          {shown && shown.matchups.length > 0 && (
            <div style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s var(--ease)" }}>
              <Scoreboard
                board={shown}
                now={clock}
                talk={(c) => <MatchupTalk card={c} now={clock} onPosted={refetch} />}
              />
            </div>
          )}
        </main>
      </PullToRefresh>
    </>
  );
}
