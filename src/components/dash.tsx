"use client";

import Link from "next/link";

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

/* ----------------------------------------------------------------- meter -- */

export function Meter({ pct, tone }: { pct: number; tone?: "wine" | "ok" }) {
  return (
    <div className="meter" data-tone={tone} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
