"use client";

import { useEffect } from "react";

/**
 * The pause before the curtain.
 *
 * Once per session, on the first screen: ink, a gold hairline monogram that
 * etches in, then the card's rules draw and its lines fade up in a stagger.
 * A little over a second, and never again until the tab is closed.
 *
 * Three rules keep it from becoming the thing people wish they could skip:
 *
 *   - It never blocks a tap. The overlay is `pointer-events: none`; a manager
 *     who knows where the lineup button is can hit it through the ink.
 *   - It never flashes. An inline script in the layout's <head> sets
 *     `data-curtain` on <html> before first paint, so the ink is there
 *     before React is. This component only takes it down.
 *   - It respects `prefers-reduced-motion`: the script does not set the
 *     attribute at all, and the page simply appears.
 */
export const CURTAIN_KEY = "mss-curtain";
export const CURTAIN_MS = 1150;

/** Runs in <head>, synchronously, before anything paints. */
export const CURTAIN_SCRIPT =
  `(function(){try{if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;` +
  `if(location.pathname!=="/")return;` +
  `if(!sessionStorage.getItem("${CURTAIN_KEY}"))document.documentElement.setAttribute("data-curtain","1")}catch(e){}})()`;

export function Curtain() {
  useEffect(() => {
    const root = document.documentElement;
    let shown = true;
    try { shown = !!sessionStorage.getItem(CURTAIN_KEY); } catch { /* private mode */ }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Development remounts strip attributes the inline script set on <html>;
    // re-apply so the reveal is visible while working on it. No-op in prod.
    if (!shown && !reduced && !root.hasAttribute("data-curtain")) root.setAttribute("data-curtain", "1");
    if (shown || reduced) { root.removeAttribute("data-curtain"); return; }

    const id = setTimeout(() => {
      root.removeAttribute("data-curtain");
      try { sessionStorage.setItem(CURTAIN_KEY, String(Date.now())); } catch { /* ignore */ }
    }, CURTAIN_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="curtain" aria-hidden>
      <svg className="curtain__mark" viewBox="0 0 64 64" fill="none">
        <circle className="curtain__ring" cx="32" cy="32" r="28.5" />
        <ellipse className="curtain__ink" cx="32" cy="21" rx="8.5" ry="2.6" />
        <path className="curtain__ink" d="M32 22.5V45" strokeLinecap="round" />
        <ellipse className="curtain__ink" cx="32" cy="45.5" rx="13" ry="3.4" />
      </svg>
    </div>
  );
}
