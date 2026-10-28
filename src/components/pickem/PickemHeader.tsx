"use client";

import { Target } from "lucide-react";
import { Kpi } from "@/components/dash";
import type { PickemSeasonStanding, PickemWeeklyStanding } from "@/lib/pickem/types";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function PickemHeader({
  week, weekCount, onWeekChange, thisWeek, season, picksRemaining,
}: {
  week: number | null;
  weekCount: number;
  onWeekChange: (week: number) => void;
  thisWeek: PickemWeeklyStanding | undefined;
  season: PickemSeasonStanding | undefined;
  picksRemaining: number;
}) {
  return (
    <>
      <section className="hero">
        <div>
          <div className="hero__eyebrow">
            <span className="badge" data-tone="wine"><Target size={12} /> Steakhouse Pick&apos;em</span>
            {season && <span className="badge" data-tone="neutral">{ordinal(season.rank)} overall</span>}
          </div>
          <h1>{week ? `Week ${week}` : "Loading…"}</h1>
          <div className="hero__cta">
            <select
              className="field"
              style={{ maxWidth: 180 }}
              value={week ?? ""}
              onChange={(e) => onWeekChange(Number(e.target.value))}
              aria-label="Select week"
            >
              {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="kpis" style={{ marginTop: "var(--s4)" }}>
        <Kpi
          label="This week"
          value={thisWeek ? `${thisWeek.correct}–${thisWeek.incorrect}` : "—"}
          tone="wine"
        />
        <Kpi
          label="Season"
          value={season ? `${season.correct}–${season.incorrect}` : "—"}
        />
        <Kpi
          label="Standing"
          value={season ? ordinal(season.rank) : "—"}
          tone="gold"
        />
        <Kpi
          label="Picks remaining"
          value={picksRemaining}
          tone={picksRemaining > 0 ? "warn" : "ok"}
        />
      </div>
    </>
  );
}
