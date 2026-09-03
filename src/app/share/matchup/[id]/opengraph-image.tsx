import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { shareCard, shareName } from "@/lib/share";

/**
 * The picture the chat unfurls: ink, gold hairlines, two names in Fraunces
 * and two numbers, and the line about who decided it. Drawn per matchup at
 * request time from the same anon read as the page.
 */
export const alt = "Main Street Steakhouse matchup";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fraunces = readFile(join(process.cwd(), "public/fonts/fraunces-500.ttf"));

const GOLD = "#c99c3f";
const CREAM = "#f3ead8";
const DIM = "#b6a992";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await shareCard(id);
  const font = await fraunces;

  const started = !!c && c.home.points + c.away.points > 0;
  const homeLead = !!c && c.home.points >= c.away.points;
  const label = !c ? "" : started ? (c.final ? "Final" : "Live") : "Projected";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", padding: 56,
          backgroundColor: "#191614",
          backgroundImage: "radial-gradient(circle at 50% 30%, #2a2420 0%, #191614 55%, #0f0d0b 100%)",
          fontFamily: "Fraunces", color: CREAM,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="44" height="44" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="28.5" stroke={GOLD} strokeWidth="2.4" />
            <ellipse cx="32" cy="21" rx="8.5" ry="2.6" stroke={CREAM} strokeWidth="2.2" />
            <path d="M32 22.5V45" stroke={CREAM} strokeWidth="2.4" strokeLinecap="round" />
            <ellipse cx="32" cy="45.5" rx="13" ry="3.4" stroke={CREAM} strokeWidth="2.2" />
          </svg>
          <div style={{ fontSize: 22, letterSpacing: 6, color: GOLD, textTransform: "uppercase" }}>
            {c ? `${c.league} · Week ${c.week} · ${label}` : "Main Street Steakhouse"}
          </div>
        </div>

        <div style={{ width: 720, height: 1, marginTop: 34, backgroundImage: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />

        {c ? (
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 56, marginTop: 36 }}>
            <Side name={c.home.name} manager={shareName(c.home)} pts={c.home.points} lead={started && homeLead} align="flex-end" />
            <div style={{ fontSize: 26, color: "#7a6f5e", letterSpacing: 8, paddingBottom: 54 }}>VS</div>
            <Side name={c.away.name} manager={shareName(c.away)} pts={c.away.points} lead={started && !homeLead} align="flex-start" />
          </div>
        ) : (
          <div style={{ fontSize: 64, marginTop: 40 }}>Members Only</div>
        )}

        <div style={{ width: 720, height: 1, marginTop: 36, backgroundImage: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />

        <div style={{ marginTop: 28, fontSize: 30, color: DIM, display: "flex" }}>
          {c?.top
            ? `Tonight's Specials: ${c.top.full_name}, ${Number(c.top.points).toFixed(1)} points.`
            : "Est. 2016 · Members Only"}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Fraunces", data: font, style: "normal", weight: 500 }] },
  );
}

function Side({ name, manager, pts, lead, align }: {
  name: string; manager: string; pts: number; lead: boolean; align: "flex-start" | "flex-end";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align, width: 400 }}>
      <div style={{ fontSize: 132, lineHeight: 1, color: lead ? GOLD : DIM, letterSpacing: -6 }}>
        {Number(pts).toFixed(1)}
      </div>
      <div style={{ fontSize: 34, marginTop: 14, color: CREAM }}>{manager}</div>
      <div style={{ fontSize: 22, marginTop: 6, color: DIM }}>{name}</div>
    </div>
  );
}
