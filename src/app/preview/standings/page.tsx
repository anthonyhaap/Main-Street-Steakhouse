"use client";

/**
 * Fixture harness for the standings board. A mid-season league with a real
 * spread of records, so the playoff odds, clinch badges and cut lines can be
 * inspected without a session or a database. Not linked from anywhere.
 *
 * The switch also renders the state the board spends its whole preseason in:
 * twelve undrafted teams, where the simulation has nothing to separate them
 * and the odds are withheld rather than printed as twelve coin flips.
 *
 * The seat decides whose race the card under the table tells: a team all but
 * in, one on the bubble with plenty riding on Sunday, one already out — or
 * nobody's, signed out.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { StandingsBoard } from "@/components/StandingsBoard";
import { PowerRankings } from "@/components/standings/PowerRankings";
import { buildOutlook } from "@/lib/fixtures/outlook";
import type { Outlook } from "@/lib/types";

const outlook = buildOutlook();

/** The same league before the draft: no results, no rosters to project. */
function preseason(): Outlook {
  return {
    ...outlook,
    week: 1,
    teams: outlook.teams.map((t) => ({
      ...t, wins: 0, losses: 0, ties: 0,
      points_for: 0, points_against: 0, scores: [], proj_ppg: null,
    })),
    matchups: outlook.matchups.map((m) => ({
      ...m, played: false, home_points: 0, away_points: 0,
    })),
  };
}

const BEFORE = preseason();

const SEATS = [
  { id: "t4", label: "In" },
  { id: "t8", label: "Bubble" },
  { id: "t11", label: "Out" },
  { id: null, label: "Signed out" },
] as const;

export default function Preview() {
  const [drafted, setDrafted] = useState(true);
  const [seat, setSeat] = useState<string | null>("t4");
  return (
    <>
      <TopBar status="live" />
      <main className="page">
        <div className="segmented" style={{ width: "max-content" }}>
          <button className="segmented__opt" data-on={!drafted} onClick={() => setDrafted(false)}>
            Before the draft
          </button>
          <button className="segmented__opt" data-on={drafted} onClick={() => setDrafted(true)}>
            Week 11
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Your seat" style={{ width: "max-content", marginTop: "var(--s2)" }}>
          {SEATS.map((x) => (
            <button key={x.label} className="segmented__opt" data-on={seat === x.id} onClick={() => setSeat(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <StandingsBoard outlook={drafted ? outlook : BEFORE} myTeamId={seat} />
        <PowerRankings outlook={drafted ? outlook : BEFORE} myTeamId={seat} />
      </main>
    </>
  );
}
