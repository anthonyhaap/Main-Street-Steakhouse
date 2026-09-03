"use client";

import { useEffect, useRef, useState } from "react";
import { Crest } from "@/components/Shell";

const THRESHOLD = 72;
const MAX = 110;

/**
 * Pull down from the top to refetch, with the crest turning as you pull.
 *
 * Only in the installed app. A browser tab already has its own pull to
 * refresh, and two of them fighting over the same gesture is worse than none.
 * In standalone mode iOS has nothing, so this is the only way a manager at a
 * tailgate gets a fresh score without finding the wire dot.
 */
export function PullToRefresh({ onRefresh, children }: {
  onRefresh: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);

  useEffect(() => {
    const standalone =
      matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || busy) return;
      startY.current = e.touches[0].clientY;
      pulling.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setPull(0); return; }
      pulling.current = true;
      // Resistance: the further you pull, the less it moves.
      setPull(Math.min(MAX, dy * 0.55));
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (!pulling.current) return;
      setPull((p) => {
        if (p >= THRESHOLD) {
          setBusy(true);
          void onRefresh().finally(() => { setBusy(false); setPull(0); });
          return THRESHOLD * 0.7;
        }
        return 0;
      });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [onRefresh, busy]);

  const ready = pull >= THRESHOLD;
  const active = pull > 0 || busy;
  return (
    <div
      className="ptr"
      style={active ? {
        transform: `translateY(${pull}px)`,
        transition: busy ? "transform 0.28s var(--ease)" : "none",
      } : undefined}
    >
      {active && (
        <div className="ptr__hint" data-busy={busy} data-ready={ready} style={{ opacity: Math.min(1, pull / THRESHOLD) }} aria-hidden>
          <span style={{ transform: `rotate(${busy ? 0 : pull * 3}deg)`, display: "inline-flex" }}><Crest size={26} /></span>
          <span className="eyebrow">{busy ? "Setting the table" : ready ? "Release" : "Pull"}</span>
        </div>
      )}
      {children}
    </div>
  );
}
