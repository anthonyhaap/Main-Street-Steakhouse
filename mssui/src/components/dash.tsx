"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";

/* ------------------------------------------------------------------ ring -- */

/** Readiness donut. Pure SVG so it prints, scales and never loads anything. */
export function Ring({ pct, passed, total }: { pct: number; passed: number; total: number }) {
  const r = 68;
  const c = 2 * Math.PI * r;
  const on = Math.max(0, Math.min(100, pct)) / 100;
  const done = passed >= total && total > 0;

  return (
    <div className="dial" data-done={done}>
      <div className="dial__wrap">
        <svg className="dial__svg" viewBox="0 0 168 168" aria-hidden>
          <circle className="dial__track" cx="84" cy="84" r={r} fill="none" strokeWidth="11" />
          <circle
            className="dial__fill"
            cx="84" cy="84" r={r} fill="none" strokeWidth="11"
            strokeDasharray={`${c * on} ${c}`}
          />
        </svg>
        <div className="dial__mid">
          <span className="dial__pct num">{pct}%</span>
          <span className="eyebrow">Ready</span>
        </div>
      </div>
      <span className="eyebrow" style={{ letterSpacing: "0.12em" }}>
        {passed} of {total} checks clear
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------- kpi -- */

export function Kpi({
  label, value, foot, tone, href, icon,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  tone?: "wine" | "gold" | "ok" | "warn";
  href?: string;
  icon?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="kpi__label eyebrow">
        {icon}
        {label}
      </span>
      <span className="kpi__value num" data-tone={tone}>{value}</span>
      {foot && <span className="kpi__foot">{foot}</span>}
    </>
  );
  return href
    ? <Link className="kpi" href={href}>{body}</Link>
    : <div className="kpi">{body}</div>;
}

/* ------------------------------------------------------------- checklist -- */

export function CheckRow({ ok, label, detail, fix }: { ok: boolean; label: string; detail: string; fix: string }) {
  return (
    <Link className="check" data-ok={ok} href={fix}>
      <span className="check__icon">{ok ? <Check strokeWidth={3} /> : <Minus strokeWidth={3} />}</span>
      <span style={{ minWidth: 0 }}>
        <span className="check__label">{label}</span>
        <span className="check__detail">{detail}</span>
      </span>
    </Link>
  );
}

/* ----------------------------------------------------------------- meter -- */

export function Meter({ pct, tone }: { pct: number; tone?: "wine" | "ok" }) {
  return (
    <div className="meter" data-tone={tone} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ time -- */

/** "in 4d 6h", "12m ago" — short, never a raw timestamp. */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const d = t - now;
  const ahead = d > 0;
  const s = Math.abs(d) / 1000;
  const out =
    s < 60 ? `${Math.round(s)}s`
    : s < 3600 ? `${Math.floor(s / 60)}m`
    : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  return ahead ? `in ${out}` : `${out} ago`;
}

export const fmtDay = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";
