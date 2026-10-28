"use client";

/**
 * One game at a time, and the way to the next one.
 *
 * This replaced a rail of every game in the week. The rail was defensible —
 * it showed you where the close game was — but it put three scorelines on a
 * screen whose entire job is one matchup, and it duplicated the collapsed
 * scoreline that appeared under it on scroll. Two bars, five scores, one
 * matchup.
 *
 * So: the current game, always, and an arrow either side. It is sticky and it
 * never changes shape, which means the answer to "which game am I looking at
 * and what is the score" is in the same place whether you are at the top of
 * the header or nine rows into the lineup — the job the collapsed bar used to
 * do on its own.
 *
 * The whole week is still in the payload the page is holding, so stepping is a
 * state change and nothing else: no fetch, no navigation, no skeleton. The
 * arrows stop at the ends rather than wrapping, because a pager that loops
 * silently reads as one that has lost its place.
 *
 * Where the rest of the league went: `/matchups` is still every game at once,
 * with the ticker across the top. That is the screen for finding a game worth
 * watching. This is the screen for watching it.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  abbr, cardState, fmt1, leader, stateWord, who,
  type ScoreCard, type Scoreboard as Board,
} from "@/lib/scoreboard";

export function MatchupPager({ board, currentId, onPick }: {
  board: Board;
  currentId: string;
  onPick: (id: string) => void;
}) {
  const at = board.matchups.findIndex((m) => m.id === currentId);
  if (at < 0) return null;
  const c = board.matchups[at];
  const prev = board.matchups[at - 1] ?? null;
  const next = board.matchups[at + 1] ?? null;
  const state = cardState(c);
  const ahead = leader(c);
  const pre = state === "pre";

  return (
    <div className="mpager">
      <Step to={prev} dir="prev" onPick={onPick} />

      <div className="mpager__game" data-state={state}>
        <PagerSide s={c.away} value={pre ? c.away.proj : c.away.points} lead={ahead === "away"} />
        <span className="mpager__state">
          {state === "live" && <i className="sb__pip" aria-hidden />}
          {stateWord(state)}
        </span>
        <PagerSide s={c.home} value={pre ? c.home.proj : c.home.points} lead={ahead === "home"} align="end" />
      </div>

      <Step to={next} dir="next" onPick={onPick} />
    </div>
  );
}

/**
 * An arrow, named after where it goes. "Next game" tells a screen reader
 * nothing it could not guess; "Prime Cut against Gridiron Butchers" is the
 * only version of this control that is worth tabbing to.
 */
function Step({ to, dir, onPick }: {
  to: ScoreCard | null; dir: "prev" | "next"; onPick: (id: string) => void;
}) {
  if (!to) return <span className="mpager__arrow" data-dir={dir} aria-hidden />;
  return (
    <button
      type="button"
      className="mpager__arrow"
      data-dir={dir}
      onClick={() => onPick(to.id)}
      aria-label={`${dir === "prev" ? "Previous" : "Next"} game: ${who(to.away)} against ${who(to.home)}`}
      title={`${abbr(to.away.name)} @ ${abbr(to.home.name)}`}
    >
      {dir === "prev" ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
    </button>
  );
}

function PagerSide({ s, value, lead, align = "start" }: {
  s: ScoreCard["home"]; value: number; lead: boolean; align?: "start" | "end";
}) {
  return (
    <span className="mpager__side" data-lead={lead} data-align={align}>
      <b>{abbr(s.name)}</b>
      <span className="num">{fmt1(value)}</span>
    </span>
  );
}

/**
 * Swipe the body to step games, which is the gesture the pager's arrows are
 * the discoverable version of.
 *
 * Deliberately passive: nothing calls `preventDefault`, so a vertical flick
 * through the lineup is never swallowed by a horizontal handler that decided
 * too early. The gesture has to be mostly sideways (twice the horizontal
 * travel of the vertical) and long enough to be meant, or it is ignored — a
 * thumb going down a nine-row lineup crosses a lot of x by accident.
 */
export function useSwipe(onPrev: () => void, onNext: () => void) {
  let x = 0, y = 0, tracking = false;

  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
      tracking = true;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - x, dy = t.clientY - y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
      (dx < 0 ? onNext : onPrev)();
    },
  };
}
