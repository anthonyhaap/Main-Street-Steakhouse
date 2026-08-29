"use client";

import { useState } from "react";
import { headshot, teamColor, teamLogo } from "@/lib/nfl/assets";
import { team as clubOf } from "@/lib/nfl/teams";
import type { HubGame, HubPlayer, WireInjury } from "@/lib/nfl/types";

/* ----------------------------------------------------------------- image -- */

/**
 * A remote image that is allowed to fail.
 *
 * Every picture on this page is a hotlink to ESPN's CDN, addressed by an id we
 * hold. Some of those addresses will 404 — a practice-squad rookie with no
 * headshot on file, a club abbreviation we guessed wrong — and a broken-image
 * glyph in a lineup row looks like a broken app. So a failed load falls back to
 * the same monogram the rest of the site uses for a team, and nobody notices.
 *
 * next/image is deliberately not used: these are third-party URLs on a fixed
 * CDN at fixed sizes, and routing them through the optimiser would buy nothing
 * but a remote-pattern allowlist to keep in sync.
 */
export function NflImage({
  src, alt, size, radius = "50%", fit = "cover", pad = 0, background, fallback,
}: {
  src: string | null;
  alt: string;
  size: number;
  radius?: string;
  fit?: "cover" | "contain";
  pad?: number;
  background?: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        aria-hidden
        style={{
          width: size, height: size, borderRadius: radius, background: background ?? "var(--ink-2)",
          display: "grid", placeItems: "center", flexShrink: 0,
          font: `400 ${Math.round(size * 0.36)}px/1 var(--serif)`, color: "var(--faint)",
        }}
      >
        {fallback ?? initials(alt)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party CDN, fixed size, no optimiser
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{
        width: size, height: size, borderRadius: radius, objectFit: fit,
        padding: pad, background: background ?? "transparent", flexShrink: 0,
        display: "block",
      }}
    />
  );
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/* ------------------------------------------------------------------ club -- */

export function TeamLogo({ abbr, size = 20 }: { abbr: string | null | undefined; size?: number }) {
  const club = clubOf(abbr);
  return (
    <NflImage
      src={teamLogo(abbr)}
      alt={club?.name ?? abbr ?? "Free agent"}
      size={size}
      radius="0"
      fit="contain"
      fallback={<span style={{ fontSize: size * 0.4 }}>{abbr ?? "FA"}</span>}
    />
  );
}

/** A player's face, on his club's colour, with the crest tucked in the corner. */
export function Face({ player, size = 44 }: { player: HubPlayer; size?: number }) {
  const color = teamColor(player.nfl_team);
  const isDst = player.position === "DST";

  return (
    <span style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <NflImage
        src={headshot(player.espn_id)}
        alt={player.full_name}
        size={size}
        fit={isDst ? "contain" : "cover"}
        pad={isDst ? Math.round(size * 0.14) : 0}
        background={color ? `${color}1f` : "var(--ink-2)"}
        fallback={initials(player.full_name)}
      />
      {!isDst && player.nfl_team && (
        <span
          style={{
            position: "absolute", right: -3, bottom: -2,
            width: size * 0.44, height: size * 0.44,
            display: "grid", placeItems: "center",
            borderRadius: "50%", background: "var(--ink-1)",
            boxShadow: "0 1px 3px #1b181433",
          }}
        >
          <TeamLogo abbr={player.nfl_team} size={Math.round(size * 0.34)} />
        </span>
      )}
    </span>
  );
}

/* --------------------------------------------------------------- kickoff -- */

const DAY = { weekday: "short", hour: "numeric", minute: "2-digit" } as const;

/** "@ PHI Sun 1:00" or "vs DAL · Final" — one line, no wrapping. */
export function Kickoff({ game, week }: { game: HubGame | null; week: number }) {
  if (!game) {
    return <span style={{ color: "var(--faint)", fontSize: "var(--t-micro)" }}>Bye week {week}</span>;
  }

  const kicked = game.status && !/^(pre|scheduled|status_scheduled)/i.test(game.status);
  const when = game.kickoff_at
    ? new Date(game.kickoff_at).toLocaleString(undefined, DAY)
    : null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
      <span style={{ color: "var(--dim)", fontSize: "var(--t-micro)", fontWeight: 700 }}>
        {game.home ? "vs" : "@"}
      </span>
      <TeamLogo abbr={game.opponent} size={16} />
      <span style={{ fontSize: "var(--t-micro)", color: "var(--muted)", whiteSpace: "nowrap" }}>
        {game.opponent}
      </span>
      <span style={{ fontSize: "var(--t-micro)", color: "var(--faint)", whiteSpace: "nowrap" }}>
        {kicked ? game.status_detail ?? game.status : when}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------- injuries -- */

const SEV_TONE: Record<WireInjury["severity"], string> = {
  out: "danger",
  doubtful: "danger",
  questionable: "warn",
  probable: "ok",
  unknown: "neutral",
};

export function InjuryBadge({ injury }: { injury: WireInjury }) {
  return (
    <span className="badge" data-tone={SEV_TONE[injury.severity]} title={injury.comment ?? undefined}>
      {injury.status}
      {injury.detail ? ` · ${injury.detail}` : ""}
    </span>
  );
}

/* ------------------------------------------------------------- sparkline -- */

/**
 * A season in 60 pixels. Not a chart — a shape: is he trending up, and how far
 * do the weeks swing? The baseline is zero so a blank week reads as a hole.
 */
export function Spark({
  points, width = 62, height = 20, color = "var(--gold-lit)",
}: {
  points: { week: number; points: number }[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => p.points), 1);
  const step = width / (points.length - 1);
  const y = (v: number) => height - 1 - (Math.max(0, v) / max) * (height - 2);
  const path = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(p.points).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false"
      style={{ display: "block", overflow: "visible" }}>
      <path d={`${path} L${width},${height} L0,${height} Z`} fill={color} opacity="0.1" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={y(last.points)} r="2.1" fill={color} />
    </svg>
  );
}

/* ------------------------------------------------------------------ misc -- */

/** Per-game usage, worded for the position it belongs to. */
export function usageLine(p: HubPlayer): string | null {
  const u = p.form?.usage;
  if (!u) return null;
  const bits: string[] = [];

  if (p.position === "QB") {
    if (u.pass_yds) bits.push(`${u.pass_yds} pass yds`);
    if (u.pass_att) bits.push(`${u.pass_att} att`);
    if (u.tds) bits.push(`${u.tds} TD`);
  } else if (p.position === "RB") {
    if (u.carries) bits.push(`${u.carries} car`);
    if (u.targets) bits.push(`${u.targets} tgt`);
    if (u.rush_yds || u.rec_yds) bits.push(`${Math.round((u.rush_yds ?? 0) + (u.rec_yds ?? 0))} yds`);
  } else if (p.position === "WR" || p.position === "TE") {
    if (u.targets) bits.push(`${u.targets} tgt`);
    if (u.catches) bits.push(`${u.catches} rec`);
    if (u.rec_yds) bits.push(`${Math.round(u.rec_yds)} yds`);
  } else if (p.position === "K") {
    if (u.fg_made) bits.push(`${u.fg_made} FG`);
  } else if (p.position === "DST") {
    if (u.sacks) bits.push(`${u.sacks} sacks`);
  }

  if (u.snap_pct) bits.push(`${Math.round(u.snap_pct)}% snaps`);
  return bits.length ? bits.join(" · ") : null;
}

export const fmtWhen = (iso: string | null) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
