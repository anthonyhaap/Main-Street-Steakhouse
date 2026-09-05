"use client";

/**
 * Fixture harness for the trade desk. Not linked from anywhere, reads nothing.
 *
 * The real screen needs a session, a drafted league and a second manager
 * willing to negotiate, so this is the same components against an invented
 * one. Three states worth seeing: an offer waiting on you, an offer waiting on
 * them, and a desk after the deadline has gone.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { Desk } from "@/components/trades/Desk";
import type { TradeDesk } from "@/lib/types";

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

export default function PreviewTrades() {
  const [shut, setShut] = useState(false);

  return (
    <>
      <TopBar />
      <main className="page" data-width="narrow">
        <div className="card">
          <div className="card__head">
            <h2>Preview: the trade desk</h2>
            <div className="segmented">
              <button className="segmented__opt" data-on={!shut} onClick={() => setShut(false)}>Open</button>
              <button className="segmented__opt" data-on={shut} onClick={() => setShut(true)}>Deadline gone</button>
            </div>
          </div>
        </div>

        <Desk
          desk={shut ? CLOSED : OPEN}
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
