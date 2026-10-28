"use client";

/**
 * Fixture harness for the trade desk. Not linked from anywhere, reads nothing.
 *
 * The real screen needs a session, a drafted league and a second manager
 * willing to negotiate, so this is the same components against an invented
 * one. Three states worth seeing: an offer waiting on you, an offer waiting on
 * them, and a desk after the deadline has gone — and, between the last two,
 * the deadline's own week and its last day, counted down on a fixed clock so
 * the page hydrates the same whenever it is opened.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { Desk } from "@/components/trades/Desk";
import type { TradeDesk } from "@/lib/types";
import type { TradeDeadline } from "@/lib/deadline";

const BLOCK = [
  { player_id: "b1", player: "Zay Flowers", position: "WR", nfl_team: "BAL",
    team_id: "t2", team: "Prime Cut", note: "want a back", mine: false },
  { player_id: "b2", player: "Tyjae Spears", position: "RB", nfl_team: "TEN",
    team_id: "t1", team: "Gridiron Butchers", note: null, mine: true },
];

const INCOMING = {
  id: "o1", status: "proposed", message: "you need a back, I need a receiver",
  created_at: "2026-09-08T14:02:00.000Z", outcome: null, counters_id: null,
  proposer_team_id: "t2", receiver_team_id: "t1",
  mine: false, from_team: "Prime Cut", to_team: "Gridiron Butchers",
  items: [
    { player_id: "p1", player: "Rome Odunze", position: "WR", nfl_team: "CHI", leaving: true },
    { player_id: "p2", player: "Jaylen Wright", position: "RB", nfl_team: "MIA", leaving: false },
  ],
};

const OUTGOING = {
  id: "o2", status: "proposed", message: null,
  created_at: "2026-09-08T09:40:00.000Z", outcome: null, counters_id: null,
  proposer_team_id: "t1", receiver_team_id: "t8",
  mine: true, from_team: "Gridiron Butchers", to_team: "Filet Force",
  items: [
    { player_id: "p3", player: "Tyjae Spears", position: "RB", nfl_team: "TEN", leaving: true },
    { player_id: "p4", player: "Cade Otton", position: "TE", nfl_team: "TB", leaving: false },
  ],
};

const SETTLED = {
  id: "o3", status: "declined", message: null,
  created_at: "2026-09-01T18:00:00.000Z", outcome: "declined", counters_id: null,
  proposer_team_id: "t1", receiver_team_id: "t12",
  mine: true, from_team: "Gridiron Butchers", to_team: "Chuck Wagon",
  items: [{ player_id: "p5", player: "Adonai Mitchell", position: "WR", nfl_team: "IND", leaving: true }],
};

const OPEN: TradeDesk = {
  week: 6, deadline_week: 12, block: BLOCK,
  offers: [INCOMING, OUTGOING, SETTLED], settled: [],
};

const CLOSED: TradeDesk = {
  week: 13, deadline_week: 12, block: BLOCK, offers: [SETTLED], settled: [],
};

// Week 12 closes four hours after Monday night's kickoff: Tue Dec 1, 12:15 AM ET.
const CLOSES = "2026-12-01T05:15:00Z";
const DEADLINE: TradeDeadline = {
  week: 12, deadline_week: 12, closes_at: CLOSES, open: true, offers: 2, trades: 1, block: 2, waiting: 1,
};

type Stage = "open" | "week" | "day" | "shut";
const STAGES: { key: Stage; label: string; now: number; desk: TradeDesk; deadline: TradeDeadline }[] = [
  { key: "open", label: "Open", now: Date.parse("2026-10-13T16:00:00Z"), desk: OPEN, deadline: { ...DEADLINE, week: 6 } },
  { key: "week", label: "Deadline week", now: Date.parse("2026-11-27T17:00:00Z"), desk: { ...OPEN, week: 12 }, deadline: DEADLINE },
  { key: "day", label: "Last day", now: Date.parse(CLOSES) - 5 * 3600_000, desk: { ...OPEN, week: 12 }, deadline: DEADLINE },
  { key: "shut", label: "Deadline gone", now: Date.parse("2026-12-02T16:00:00Z"), desk: CLOSED, deadline: { ...DEADLINE, week: 13, open: false } },
];

export default function PreviewTrades() {
  const [stage, setStage] = useState<Stage>("open");
  const s = STAGES.find((x) => x.key === stage)!;

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head">
            <h2>Preview: the trade desk</h2>
            <div className="scroll" style={{ overflowX: "auto", maxWidth: "100%" }}>
              <div className="segmented" style={{ width: "max-content" }}>
                {STAGES.map((x) => (
                  <button key={x.key} className="segmented__opt" data-on={stage === x.key} onClick={() => setStage(x.key)}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <Desk
          desk={s.desk}
          deadline={s.deadline}
          now={s.now}
          busy={null}
          onRespond={() => {}}
          onCounter={() => {}}
          onOpenBlock={() => {}}
          onMakeOffer={() => {}}
        />
      </main>
    </>
  );
}
