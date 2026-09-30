"use client";

/**
 * The Steakhouse ticker: one line at a time along the bottom of the screen,
 * the most important first, each one a way into the thing it is about.
 *
 * Six seconds a line — long enough to read a sentence with the television on,
 * short enough that the rail is never stale. It holds while a pointer or the
 * keyboard is on it, so nothing moves out from under a tap.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TickerItem, TickerTarget } from "@/lib/sunday";

const DWELL = 6000;

export function SundayTicker({ items, onTarget }: { items: TickerItem[]; onTarget: (t: TickerTarget) => void }) {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const n = items.length;

  useEffect(() => {
    if (held || n < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % n), DWELL);
    return () => clearInterval(id);
  }, [held, n]);

  if (n === 0) return null;
  const at = i % n;
  const item = items[at];

  return (
    <div
      className="sun-ticker" role="region" aria-label="Steakhouse live ticker"
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}
    >
      <span className="sun-ticker__brand"><span aria-hidden>🥩</span><b>Steakhouse live</b></span>
      <div className="sun-ticker__stage">
        <button key={`${item.id}-${at}`} type="button" className="sun-ticker__item" data-hot={item.hot}
          onClick={() => onTarget(item.target)}>
          <span>{item.text}</span>
        </button>
      </div>
      {n > 1 && (
        <span className="sun-ticker__nav">
          <button type="button" className="sun-btn" style={{ padding: 4, border: 0, background: "none" }}
            aria-label="Previous" onClick={() => setI((at - 1 + n) % n)}><ChevronLeft size={14} /></button>
          <span>{at + 1}/{n}</span>
          <button type="button" className="sun-btn" style={{ padding: 4, border: 0, background: "none" }}
            aria-label="Next" onClick={() => setI((at + 1) % n)}><ChevronRight size={14} /></button>
        </span>
      )}
    </div>
  );
}
