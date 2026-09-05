"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CURTAIN_KEY } from "@/components/Curtain";

/**
 * The doors.
 *
 * Signing in is the one moment in this app that can afford some theatre. Two
 * black doors take the screen, the house mark splits down the middle, and they
 * swing open on a room: near black, thick with smoke, cut by hard shafts of
 * light off a lamp at the far end. You walk at it, it blooms, and you are in.
 * It plays on the way through `/login` and `/join` — the two doors of the
 * building — and nowhere else.
 *
 * It lives in the root layout rather than on those two screens, because the
 * whole point is that it outlasts them: the leaves open, the white takes the
 * screen, `router.push` swaps the page underneath, and the smoke thins on the
 * far side to reveal wherever you were going. A layout is the only thing in an
 * App Router tree that survives that navigation.
 *
 * Three rules, the same three the curtain plays by:
 *
 *   - It never traps anyone. The overlay unmounts on its own timer, so a route
 *     that never arrives still leaves a usable app behind it.
 *   - It never flashes. The white holds through the handoff and past it, so a
 *     slow first paint on the far side is covered rather than caught out.
 *   - It respects `prefers-reduced-motion`: `enterThroughDoors` just navigates,
 *     and the overlay is never mounted at all.
 *
 * The numbers below are the same beats as the `.doors` keyframes in
 * globals.css. Change one, change both.
 */

/** White is total by here; the route changes underneath it. */
export const DOOR_HANDOFF = 2600;
/** Mount to unmount: hold, swing, the room, the bloom, and the clearing after. */
export const DOOR_TOTAL = 3500;

/* ------------------------------------------------------------------ store --
   One boolean, outside React, because the thing that starts the doors (a form
   handler on a screen that is about to be navigated away from) and the thing
   that draws them (the layout, which is not) never share a tree. */

let playing = false;
const listeners = new Set<() => void>();

function setPlaying(next: boolean) {
  playing = next;
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

const readPlaying = () => playing;
const readPlayingOnServer = () => false;

function reducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Open the doors, then run `go` — a `router.push` — while the screen is white.
 *
 * Falls straight through to `go()` when motion is reduced, when there is no
 * browser, or when a set of doors is already open, so a caller never has to
 * think about any of those cases.
 */
export function enterThroughDoors(go: () => void) {
  if (typeof window === "undefined" || playing || reducedMotion()) {
    go();
    return;
  }

  // The doors are the entrance now. The ink curtain on Tonight's Table is the
  // same beat played a second time, so mark it seen on the way through.
  try { window.sessionStorage.setItem(CURTAIN_KEY, String(Date.now())); } catch { /* private mode */ }

  setPlaying(true);
  window.setTimeout(go, DOOR_HANDOFF);
}

/* ------------------------------------------------------------------- host -- */

export function DoorsHost() {
  const open = useSyncExternalStore(subscribe, readPlaying, readPlayingOnServer);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setPlaying(false), DOOR_TOTAL);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return (
    <div className="doors" role="presentation">
      {/* The room on the other side. Haze first, because a beam is only a beam
          once there is something in the air for it to land on. */}
      <div className="doors__room" aria-hidden>
        <span className="doors__haze" />
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="doors__beam" data-i={i} />)}
        <span className="doors__lamp" />
      </div>
      <div className="doors__smoke" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <span key={i} className="doors__puff" data-i={i} />)}
      </div>

      {/* Light in the crack, gone the moment the leaves part. */}
      <div className="doors__seam" />

      {(["l", "r"] as const).map((side) => (
        <div key={side} className="doors__leaf" data-side={side}>
          <span className="doors__grain" />
          <span className="doors__panel" />
          <span className="doors__handle" />
          {/* Viewport-wide inside a half-width leaf: the mark is drawn once on
              each face at the same place on screen, so the seam cuts it in two. */}
          <div className="doors__face"><Plate /></div>
        </div>
      ))}

      {/* Reaching the lamp, and the last of the room going with it. */}
      <div className="doors__bloom" />
      <div className="doors__veil">
        {[0, 1, 2].map((i) => <span key={i} className="doors__wisp" data-i={i} />)}
      </div>
    </div>
  );
}

/**
 * The crest, cut for brass on black.
 *
 * `/logo-full.png` is ink on paper — invisible on a black door — so the mark is
 * redrawn here in cream and gold at the logo's own proportions. The ring is two
 * arcs rather than a circle with a mask: the original's ring is interrupted by
 * the two words exactly where these two arcs end.
 *
 * `textLength` pins each line to the width it has on the crest, so the plate
 * holds its proportions in the moments before Fraunces arrives, and forever on
 * a browser that never gets it.
 */
function Plate() {
  return (
    <svg className="doors__plate" viewBox="0 0 782 874" fill="none" aria-hidden>
      <path className="doors__ring" d="M130.6 195A298 298 0 0 1 653.4 195" />
      <path className="doors__ring" d="M682.4 405A298 298 0 0 1 101.6 405" />

      <text className="doors__word" x="392" y="268" textLength="660" lengthAdjust="spacingAndGlyphs">
        MAIN STREET
      </text>
      <text className="doors__word" data-lit x="392" y="393" textLength="770" lengthAdjust="spacingAndGlyphs">
        STEAKHOUSE
      </text>
      <text className="doors__est" x="392" y="487" textLength="232" lengthAdjust="spacingAndGlyphs">
        EST. 2016
      </text>

      {/* The table: a pedestal, seen end on. */}
      <ellipse className="doors__mark" cx="392" cy="543" rx="30" ry="9" />
      <path className="doors__mark" d="M392 552V766" strokeLinecap="round" />
      <ellipse className="doors__mark" cx="392" cy="766" rx="55" ry="12" />

      <text className="doors__est" x="392" y="866" textLength="318" lengthAdjust="spacingAndGlyphs">
        MEMBERS ONLY
      </text>
    </svg>
  );
}
