"use client";

/**
 * The week's other games, as a rail you swipe.
 *
 * The ticker this replaces on the full-screen matchup was a row of links: each
 * one a page load, and the game you were already looking at deliberately
 * missing from it, so the rail never showed you where you were. That is the
 * wrong shape for the thing people actually do on a Sunday — check their own
 * game, swipe to the closest one in the house, find somebody losing, and go
 * say so in the chat. Every hop through a route is a beat of that loop spent
 * on a spinner.
 *
 * So this is a selector, not a set of links. The whole week is already in the
 * one `ff_scoreboard` payload the page is holding, so picking another game is
 * a state change and nothing else: no fetch, no navigation, no skeleton. The
 * URL is rewritten underneath with the History API so the game on screen is
 * still the game you can send to somebody.
 *
 * Buttons rather than links is the one thing lost — a matchup can no longer be
 * cmd-clicked out of the rail into a new tab. The rail on the list page is
 * still links, and that is where a reader who wants four tabs open is.
 *
 * The arrows are not decoration. A row that scrolls with no arrows on it is a
 * row most people never learn scrolls, and the two managers most likely to be
 * on a desktop browser with no touch at all are the commissioner and whoever
 * is arguing with him.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  abbr, cardState, fmt1, leader, stateWord,
  type ScoreCard, type Scoreboard as Board,
} from "@/lib/scoreboard";

export function MatchupNavigator({ board, currentId, onPick }: {
  board: Board;
  currentId: string;
  onPick: (id: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  // Whether there is anything off either edge. An arrow pointing at nothing
  // is a promise the rail cannot keep, so it goes away instead of greying.
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    // A pixel of slack: fractional layout widths mean scrollLeft rarely
    // reaches scrollWidth - clientWidth exactly, and an arrow that never
    // switches off at the end is worse than no arrow.
    const max = el.scrollWidth - el.clientWidth;
    setMore({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, board.matchups.length]);

  // Bring the selected game into the middle of the rail, by hand rather than
  // with `scrollIntoView`: that scrolls every scrollable ancestor, which on a
  // sticky rail means the page jumps too.
  useEffect(() => {
    const el = rail.current;
    const pill = el?.querySelector<HTMLElement>(`[data-id="${CSS.escape(currentId)}"]`);
    if (!el || !pill) return;
    el.scrollLeft = pill.offsetLeft - (el.clientWidth - pill.clientWidth) / 2;
    measure();
  }, [currentId, measure]);

  const nudge = (dir: -1 | 1) => {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  if (board.matchups.length === 0) return null;

  return (
    <div className="mnav">
      <button
        type="button"
        className="mnav__arrow"
        data-dir="left"
        onClick={() => nudge(-1)}
        aria-label="Earlier games in the week"
        hidden={!more.left}
      >
        <ChevronLeft size={16} />
      </button>

      <div
        className="mnav__rail"
        ref={rail}
        onScroll={measure}
        aria-label={`Every game in week ${board.week}`}
        role="group"
      >
        {board.matchups.map((c) => (
          <NavGame key={c.id} c={c} on={c.id === currentId} onPick={onPick} />
        ))}
      </div>

      <button
        type="button"
        className="mnav__arrow"
        data-dir="right"
        onClick={() => nudge(1)}
        aria-label="Later games in the week"
        hidden={!more.right}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function NavGame({ c, on, onPick }: { c: ScoreCard; on: boolean; onPick: (id: string) => void }) {
  const state = cardState(c);
  const pre = state === "pre";
  const ahead = leader(c);

  return (
    <button
      type="button"
      className="mnav__game"
      data-id={c.id}
      data-on={on}
      data-state={state}
      // Not `role="tab"`: that promises arrow-key roving focus and a labelled
      // panel, neither of which this implements. What it is — a button that
      // says which of several things is showing — is what `aria-current`
      // means with no role at all.
      aria-current={on}
      onClick={() => onPick(c.id)}
    >
      <span className="mnav__pair">
        <NavSide c={c} side="away" value={pre ? c.away.proj : c.away.points} lead={ahead === "away"} />
        <NavSide c={c} side="home" value={pre ? c.home.proj : c.home.points} lead={ahead === "home"} />
      </span>
      <span className="mnav__state">
        {state === "live" && <i className="sb__pip" aria-hidden />}
        {stateWord(state)}
      </span>
      {c.mine && <span className="mnav__mine" aria-label="Your table">★</span>}
    </button>
  );
}

function NavSide({ c, side, value, lead }: {
  c: ScoreCard; side: "home" | "away"; value: number; lead: boolean;
}) {
  const s = c[side];
  return (
    <span className="mnav__side" data-lead={lead}>
      <b>{abbr(s.name)}</b>
      <span className="num">{fmt1(value)}</span>
    </span>
  );
}
