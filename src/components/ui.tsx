"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { teamHref, teamLinkLabel } from "@/lib/team-link";

/* ---------------------------------------------------------------- toasts -- */

type ToastKind = "ok" | "error" | "info";
type Toast = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, kind, text }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6500 : 3800);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-kind={t.kind} role="status">
            {t.kind === "ok" && <CheckCircle2 size={15} color="var(--win)" style={{ flexShrink: 0 }} />}
            {t.kind === "error" && <AlertTriangle size={15} color="var(--qb)" style={{ flexShrink: 0 }} />}
            {t.kind === "info" && <Info size={15} color="var(--gold)" style={{ flexShrink: 0 }} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------- skeletons -- */

export function Skeleton({ h = 14, w = "100%", style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} />;
}

/** Rows of shimmer that match the shape of a list, so loading never jumps. */
export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <div className="rows">
      {Array.from({ length: n }, (_, i) => (
        <div className="row" key={i} style={{ gap: 12 }}>
          <Skeleton h={20} w={34} />
          <div style={{ flex: 1, display: "grid", gap: 6 }}>
            <Skeleton h={12} w={`${45 + ((i * 13) % 35)}%`} />
            <Skeleton h={9} w={`${25 + ((i * 7) % 20)}%`} />
          </div>
          <Skeleton h={16} w={40} />
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- seals -- */

/**
 * A team's mark: its crest when the manager has uploaded one, and otherwise the
 * two-letter monogram drawn from its name.
 *
 * The monogram is the floor, not a placeholder to be replaced everywhere: a
 * crest that 404s — a file deleted out from under the column — falls straight
 * back to it rather than leaving a broken box in the standings.
 */
export function Seal({ name, src = null, mine = false, size = 30 }: {
  name: string;
  /** Public URL of the team's crest, from `crestUrl()`. */
  src?: string | null;
  mine?: boolean;
  size?: number;
}) {
  const initials = useMemo(() => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "—";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }, [name]);

  // The URL that failed, rather than a flag: a new crest is a new URL, so
  // choosing a different picture clears the fallback without an effect to
  // reset it.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const crest = src && src !== failedSrc ? src : null;

  return (
    <span
      className="seal"
      data-mine={mine}
      data-crest={!!crest}
      // The monogram scales with the disc, but never below the nine-pixel floor
      // every other letter in the app keeps: a 24px seal is still read.
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.37) }}
      aria-hidden
    >
      {crest ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage object, fixed size, no optimiser
        <img src={crest} alt="" width={size} height={size} loading="lazy" decoding="async"
          onError={() => setFailedSrc(src)} />
      ) : initials}
    </span>
  );
}

/* ------------------------------------------------------------ team doors -- */

/**
 * A team, as a door to its desk.
 *
 * Wraps whatever names the team — the crest, the name, the manager, the record,
 * the score, or all of them — so the whole block is one hit target instead of
 * the handful of characters in the name. On a phone that is the difference
 * between a feature and a rumour about one: a 28-pixel crest beside a nine-
 * character name is hard to hit on purpose, and the row around them is not.
 *
 * A team with no id is still drawn, as the same anchor with no `href` on it —
 * an `<a>` without one is inert, unfocusable and styled by `[href]`-scoped
 * rules, so it looks and behaves like the text it replaced. That is worth more
 * than dropping the element: the box stays, so nothing on a board reflows
 * because one payload quoted a team by name instead of by id, and an anchor's
 * content model takes the blocks these doors wrap where a `<span>` would not.
 */
export function TeamLink({ id, name, mine = false, className = "tlink", style, children }: {
  id: string | null | undefined;
  /**
   * The team's name, for the link's label only — the visible children are
   * frequently a crest and a number rather than the name itself.
   */
  name: string;
  mine?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const href = teamHref(id, mine);
  if (!href) return <a className={className} style={style}>{children}</a>;
  const label = teamLinkLabel(name, mine);
  return (
    <Link href={href} className={className} style={style} aria-label={label} title={label}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------ formatting -- */

export const fmtPts = (n: number | string | null | undefined) =>
  Number(n ?? 0).toFixed(1);

/** Counts up to a new score instead of snapping — makes live scoring feel live. */
export function useCountUp(target: number, ms = 550) {
  const [shown, setShown] = useState(target);
  useEffect(() => {
    const from = shown;
    const delta = target - from;
    if (Math.abs(delta) < 0.05) {
      setShown(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + delta * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);
  return shown;
}
