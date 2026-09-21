"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import { type ScoreCard, type Scoreboard as Board } from "@/lib/scoreboard";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { VsLineups } from "@/components/Scoreboard";
import { ScoreTicker, abbr } from "@/components/matchup/ScoreTicker";

/**
 * /matchups/[id] — one game, the whole screen.
 *
 * The list page is every game, your own three times the size, everything a
 * card can say about it. This is the opposite bet: one game, the lineup
 * already open, nothing else — the ESPN matchup tab rather than the ESPN
 * scoreboard. Switching games happens here, not by leaving: the ticker along
 * the top and the picker in the header both jump straight to another one
 * without a trip back through the list.
 */
export default function MatchupRoute({ params }: PageProps<"/matchups/[id]">) {
  const { id } = use(params);
  const router = useRouter();
  const { ready } = useSession();
  const [week, setWeek] = useState<number | null>(null);

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
    tables: ["matchups", "rosters", "nfl_games"],
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

  return (
    <>
      <TopBar status={status} />
      {shown && <ScoreTicker board={shown} currentId={id} />}
      <main className="page" data-layout="matchup">
        <div className="matchup-full__back">
          <Link href={`/matchups${shown ? `?week=${shown.week}` : ""}`} className="btn" data-v="ghost" data-size="sm">
            <ArrowLeft size={13} /> Matchups
          </Link>
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
          <div className="matchup-full__lineup">
            <VsLineups
              away={card.away}
              home={card.home}
              now={clock}
              head={shown.matchups.length > 1 && (
                <MatchupPicker
                  matchups={shown.matchups}
                  currentId={id}
                  onPick={(pickedId) => router.push(`/matchups/${pickedId}?week=${shown.week}`)}
                />
              )}
            />
          </div>
        )}
      </main>
    </>
  );
}

/**
 * A native `<select>` sat here first and lost: Chromium's own rendering of
 * a styled select's closed-state text does not reliably respect its box —
 * even with `appearance: none`, the display text can paint past its own
 * width instead of eliding, which on a pill this narrow read as the score
 * beside it. A button and a small menu are more code than one element, but
 * every pixel of them is ours.
 *
 * Deliberately not `role="listbox"`/`role="option"`: that pattern promises
 * arrow-key roving focus and Home/End, which this does not implement. What
 * it actually is — a button that discloses a plain list of other buttons,
 * Tab-reachable and Enter/Space-activatable for free — is exactly what it
 * claims to be with no ARIA role on the list at all. Escape closes it and
 * returns focus to the trigger, the one keyboard behavior a disclosure like
 * this does owe.
 */
function MatchupPicker({ matchups, currentId, onPick }: {
  matchups: ScoreCard[]; currentId: string; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = matchups.find((m) => m.id === currentId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="matchup-full__pick-wrap" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className="matchup-full__pick"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? `${abbr(current.away.name)} @ ${abbr(current.home.name)}` : "Games"}
        <ChevronDown size={12} />
      </button>
      {open && (
        <ul className="matchup-full__menu">
          {matchups.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-current={m.id === currentId}
                onClick={() => { onPick(m.id); setOpen(false); }}
              >
                {abbr(m.away.name)} @ {abbr(m.home.name)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
