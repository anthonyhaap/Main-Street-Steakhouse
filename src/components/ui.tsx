"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

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

/** Two-letter monogram for a team. Deterministic, no images to load. */
export function Seal({ name, mine = false, size = 30 }: { name: string; mine?: boolean; size?: number }) {
  const initials = useMemo(() => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "—";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }, [name]);

  return (
    <span
      className="seal"
      data-mine={mine}
      style={{ width: size, height: size, fontSize: size * 0.37 }}
      aria-hidden
    >
      {initials}
    </span>
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
