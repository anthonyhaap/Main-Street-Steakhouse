"use client";

/**
 * Fixture harness for the Weekly Special page. Reads no database.
 *
 * The invented season from /preview/standings, written up as of week 10, with
 * a wire, two decided bets, the league's reactions and — behind the switch —
 * the signed-in seat's own line, or none for a seat that did not play.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { RecapPage } from "@/components/recap/RecapPage";
import { buildOutlook } from "@/lib/fixtures/outlook";
import { recapWeekOutlook, type RecapRow, type SettledBet, type WireCount } from "@/lib/recap";
import type { Reaction } from "@/lib/types";

const OUTLOOK = recapWeekOutlook(buildOutlook(), 10);

const RECAP: RecapRow = {
  week: 10,
  created_at: "2026-11-17T13:00:00.000Z",
  message_id: "house-10",
  body: [
    "The Weekly Special · Week 10",
    "",
    "Tom 130.1 — Nate 83.9",
    "Dave 142.6 — Marcus 118.2",
    "Sam 104.2 — Kai 103.4",
    "Owen 104.2 — Priya 99.1",
    "",
    "Tonight's Specials: Dave, 142.6.",
    "Sent back to the kitchen: Nate, 83.9.",
    "The Bill: Tom by 46.2 over Nate.",
    "Last Call: Sam edged Kai by 0.8.",
    "Left on the pass: Priya sat Trey McBride (22.4) and lost by 5.1.",
    "Player of the week: Puka Nacua (LAR), 34.2, for Dave.",
  ].join("\n"),
};

const WIRE: WireCount[] = [
  { kind: "waiver", label: "waiver claims", count: 7 },
  { kind: "add_drop", label: "add/drops", count: 3 },
  { kind: "trade", label: "trades", count: 1 },
];

const SETTLED: SettledBet[] = [
  { id: "c1", title: "Higher Week 10 score", status: "settled", winner: "Dave", amount: "$20" },
  { id: "c2", title: "Most points in Week 10", status: "resolved", winner: "Tom", amount: "$10" },
];

export default function PreviewRecap() {
  const [seated, setSeated] = useState(true);
  const [reactions, setReactions] = useState<Reaction[]>([
    { emoji: "🔥", count: 4, mine: false }, { emoji: "💀", count: 2, mine: false },
  ]);
  const [shared, setShared] = useState(false);

  const react = (emoji: string) => setReactions((rs) => {
    const has = rs.find((r) => r.emoji === emoji);
    if (!has) return [...rs, { emoji, count: 1, mine: true }];
    return rs.map((r) => (r.emoji === emoji ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine } : r))
      .filter((r) => r.count > 0);
  });

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head">
            <h2>Preview: the Weekly Special</h2>
            <div className="segmented" role="group" aria-label="Seat">
              <button className="segmented__opt" data-on={seated} onClick={() => setSeated(true)}>Signed in</button>
              <button className="segmented__opt" data-on={!seated} onClick={() => setSeated(false)}>Signed out</button>
            </div>
          </div>
          {shared && <div className="card__body"><span className="eyebrow" data-testid="shared">shared</span></div>}
        </div>

        <RecapPage
          recap={RECAP} weeks={[10, 9, 8]} outlook={OUTLOOK} myTeamId={seated ? "t1" : null}
          mine={seated ? { title: "You beat Mike by 13.5.", body: "Up to 2nd. Two straight." } : null}
          reactions={reactions} busy={false} onReact={react} onShare={() => setShared(true)}
          wire={WIRE} settled={SETTLED}
        />
      </main>
    </>
  );
}
