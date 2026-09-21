"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import { cardLine, type Scoreboard as Board } from "@/lib/scoreboard";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { VsLineups } from "@/components/Scoreboard";
import { MatchupHead } from "@/components/matchup/MatchupHead";
import { MatchupPager, useSwipe } from "@/components/matchup/MatchupPager";
import { MatchupTalk } from "@/components/matchup/Talk";

/**
 * /matchups/[id] — one game, the whole screen.
 *
 * The list page is every game, your own three times the size, everything a
 * card can say about it. This is the opposite bet: one game, in the order a
 * live scoreboard answers questions in — which two teams, what the score is,
 * who is winning, who is still to play, then the lineups, then a man's stat
 * line only if you ask for it, then the argument.
 *
 * Three things it does that the version before it did not.
 *
 * The header is a scoreboard rather than a caption: two names, two scores, two
 * projections, the odds and what each side has left, balanced either side of
 * the middle. It used to be a dropdown in the lineup table's header, and the
 * score was a number you had to find in a row of small print above the rail.
 *
 * One matchup is on screen, and only one. Stepping to another costs nothing:
 * `ff_scoreboard` returns the whole week in one call and this page is already
 * holding it, so the pager along the top is a selector over data in hand — no
 * route change, no refetch, no skeleton. The URL is rewritten underneath with
 * the History API, which the App Router reads as its own, so the game on
 * screen stays the game you can send to somebody. The body takes the same
 * step from a sideways swipe.
 *
 * The pager is sticky and never changes shape, so "which game is this and
 * what is the score" is answered in the same place at the top of the header
 * and nine rows into the lineup. It replaced a rail of every game in the week
 * plus a separate collapsed scoreline underneath it — two bars and five
 * scorelines on a screen about one matchup.
 */

export default function MatchupRoute({ params }: PageProps<"/matchups/[id]">) {
  const { id: routeId } = use(params);
  const { ready } = useSession();
  const [week, setWeek] = useState<number | null>(null);

  // Which game is on screen. Seeded from the route and then owned here: the
  // rail changes it without a navigation, so the route param is the first
  // answer rather than the only one.
  const [id, setId] = useState(routeId);
  // A real navigation to a different matchup — a link from the list page, the
  // back button — still wins over what the rail last chose. Adjusted during
  // render rather than in an effect: the App Router reuses this component
  // across `/matchups/a` → `/matchups/b`, so an effect would paint one frame
  // of the previous game under the new URL first.
  const [fromRoute, setFromRoute] = useState(routeId);
  if (fromRoute !== routeId) { setFromRoute(routeId); setId(routeId); }

  useEffect(() => {
    if (!ready) return;
    const asked = Number(new URLSearchParams(window.location.search).get("week"));
    const wanted = Number.isInteger(asked) && asked >= 1
      ? Promise.resolve(asked)
      : supabaseBrowser().rpc("ff_current_week").then(({ data }) => (data as number) ?? 1);
    void wanted.then(setWeek);
  }, [ready]);

  // Same fifteen-seconds-live / minute-quiet contract as the list page.
  const [hot, setHot] = useState(false);
  const fetcher = useCallback(async (): Promise<Board> => {
    const { data, error } = await supabaseBrowser()
      .rpc("ff_scoreboard", { p_league_id: LEAGUE_ID, p_week: week });
    if (error) throw new Error(error.message);
    const board = data as Board;
    setHot((board.games?.in_progress ?? 0) > 0);
    return board;
  }, [week]);

  const { data: shown, status, error, refetch } = useLive<Board>(fetcher, {
    // `league_messages` is on the list because table talk lives on this screen
    // now, so a line said about this game lights up without a reload.
    tables: ["matchups", "rosters", "nfl_games", "league_messages"],
    channel: "scoreboard",
    pollMs: hot ? 15000 : 60000,
    enabled: ready && week !== null,
  });

  const { serverNow, synced } = useServerClock();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(synced ? serverNow() : Date.now()), 1000);
    return () => clearInterval(t);
  }, [synced, serverNow]);
  const clock = now || (shown ? new Date(shown.now).getTime() : 0);

  const card = shown?.matchups.find((m) => m.id === id);

  /**
   * Pick another game off the rail.
   *
   * `history.replaceState` rather than `router.push`: the App Router treats a
   * native history call as its own, so the address bar and any share of it are
   * correct, while the page it is already rendering — from a payload that
   * contains every game in the week — is not torn down and refetched. Replace
   * rather than push, because a rail you can swipe five times in two seconds
   * would otherwise bury the page you came from under five entries of the same
   * screen.
   */
  const pick = useCallback((next: string) => {
    if (next === id) return;
    setId(next);
    const qs = shown ? `?week=${shown.week}` : "";
    window.history.replaceState(null, "", `/matchups/${next}${qs}`);
  }, [id, shown]);

  // Stepping one game either way, for the arrows and for the swipe. Clamped
  // rather than wrapped: a pager that loops silently reads as one that has
  // lost its place.
  const step = useCallback((by: 1 | -1) => {
    if (!shown) return;
    const at = shown.matchups.findIndex((m) => m.id === id);
    const to = shown.matchups[at + by];
    if (at >= 0 && to) pick(to.id);
  }, [shown, id, pick]);
  const swipe = useSwipe(() => step(-1), () => step(1));

  const line = useMemo(
    () => (card && shown ? cardLine(card, shown.my_team_id) : null),
    [card, shown],
  );

  return (
    <>
      <TopBar status={status} />

      {/* Sticky under the top bar, and the only thing on this screen that
          names another game — by where its arrows go, not by its score. */}
      {shown && card && (
        <div className="mv-stick">
          <MatchupPager board={shown} currentId={id} onPick={pick} />
        </div>
      )}

      <main className="page mv" {...swipe}>
        <div className="mv__back">
          <Link href={`/matchups${shown ? `?week=${shown.week}` : ""}`} className="btn" data-v="ghost" data-size="sm">
            <ArrowLeft size={13} /> Matchups
          </Link>
          {shown && <span className="eyebrow">Week {shown.week}</span>}
        </div>

        {!shown && !error && <div className="card"><SkeletonRows n={8} /></div>}

        {!shown && error && (
          <div className="card">
            <div className="empty">
              This matchup didn&apos;t load.<br />{error}
              <div style={{ marginTop: "var(--s4)" }}>
                <button className="btn" onClick={() => void refetch()}>Try again</button>
              </div>
            </div>
          </div>
        )}

        {shown && !card && (
          <div className="card">
            <div className="empty">
              That game isn&apos;t on the board for week {shown.week}.
            </div>
          </div>
        )}

        {shown && card && (
          <>
            {/* Keyed for the same reason the thread below is: `useCountUp`
                tweens from the score it last showed, so without this the
                new game's header spends half a second counting from the old
                game's total — a number belonging to neither, under the new
                game's name. Within a matchup the key holds, so a real live
                score still counts up the way it should. */}
            <MatchupHead key={card.id} c={card} now={clock} />
            {/* Where the game stands, in one sentence, written from the
                reader's side of it — the same line the card on the list page
                carries, because it is the same game. */}
            {line && <p className="mv__line">{line}</p>}

            <VsLineups away={card.away} home={card.home} now={clock} bench head={null} />

            {/* Last, because it is the one thing on the screen that grows —
                and because the loop this page is built for ends here: see
                somebody losing, say so.

                Keyed by the matchup, which the rail made necessary. Switching
                games used to be a route change that remounted everything;
                now it is a state change, so without a key React keeps this
                instance and its open thread across the switch. `useLive`
                holds the last thread it fetched and its `refetch` keeps one
                identity across a fetcher change, so the old game's messages
                would sit under the new game's header until the resubscribed
                channel refetched — or, with realtime down, until the
                thirty-second poll. The wrong argument attributed to the
                wrong table is the one thing this screen must never do. */}
            <MatchupTalk key={card.id} card={card} now={clock} onPosted={refetch} />
          </>
        )}
      </main>
    </>
  );
}
