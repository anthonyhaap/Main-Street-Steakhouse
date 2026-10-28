"use client";

/**
 * The Steakhouse ticker: a crawl along the bottom of the screen, the most
 * important line first, each one a way into the thing it is about.
 *
 * It moves at a reading pace — a fixed speed in pixels, not a fixed time, so
 * a long Sunday crawls no faster than a quiet one — and stops while a pointer
 * or the keyboard is on it, so nothing slides out from under a tap.
 *
 * Under `prefers-reduced-motion` it does not move at all: the same lines sit
 * in a strip the reader can swipe through. The second copy that makes the
 * crawl seamless is hidden from assistive technology and from the tab order,
 * so a screen reader hears each line once.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TickerItem, TickerTarget } from "@/lib/sunday";

/** Pixels a second. Slow enough to read a line with the television on. */
const SPEED = 48;
/** More than this and the loop takes longer than anybody watches it. */
const MAX_ITEMS = 16;

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduce;
}

export function SundayTicker({ items, onTarget }: { items: TickerItem[]; onTarget: (t: TickerTarget) => void }) {
  const shown = items.slice(0, MAX_ITEMS);
  const reduce = useReducedMotion();
  const list = useRef<HTMLUListElement>(null);
  const [dur, setDur] = useState(0);
  const sig = shown.map((i) => i.id + i.text).join("|");

  useIso(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => setDur(Math.max(16, Math.round(el.scrollWidth / SPEED)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig]);

  if (shown.length === 0) return null;
  const crawl = !reduce && dur > 0;

  const row = (copy: boolean) => (
    <ul className="sun-ticker__list" ref={copy ? undefined : list} aria-hidden={copy || undefined} data-copy={copy || undefined}>
      {shown.map((item) => (
        <li key={item.id}>
          <button type="button" className="sun-ticker__item" data-hot={item.hot}
            tabIndex={copy ? -1 : undefined} onClick={() => onTarget(item.target)}>
            {item.text}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="sun-ticker" role="region" aria-label="Steakhouse live ticker" data-motion={crawl ? "crawl" : "still"}>
      <span className="sun-ticker__brand"><span aria-hidden>🥩</span><b>Steakhouse live</b></span>
      <div className="sun-ticker__stage">
        <div className="sun-ticker__track" style={crawl ? { animationDuration: `${dur}s` } : undefined}>
          {row(false)}
          {crawl && row(true)}
        </div>
      </div>
    </div>
  );
}
