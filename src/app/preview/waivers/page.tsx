"use client";

/**
 * Fixture harness for the wire. Not linked from anywhere, reads no database.
 *
 * The real screen needs a session, a drafted league and somebody to have
 * dropped a player, which is three things a test cannot arrange. This is the
 * same components against an invented league, so the sentences can be asserted
 * — and the two states worth seeing are both here: a manager with claims in,
 * and an empty wire, which is what most Tuesdays actually look like.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { Wire } from "@/components/waivers/Wire";
import { ClaimSheet } from "@/components/waivers/ClaimSheet";
import type { Owned } from "@/components/players/DropPicker";
import type { WaiverBoard, WaiverPlayer } from "@/lib/types";

const WEDNESDAY = "2026-09-09T08:00:00.000Z";

const ROSTER: Owned[] = [
  { player_id: "r1", player: "Trey McBride", position: "TE", nfl_team: "ARI", team_id: "t1", team: "Gridiron Butchers" },
  { player_id: "r2", player: "Rome Odunze", position: "WR", nfl_team: "CHI", team_id: "t1", team: "Gridiron Butchers" },
  { player_id: "r3", player: "Tyjae Spears", position: "RB", nfl_team: "TEN", team_id: "t1", team: "Gridiron Butchers" },
];

const FULL: WaiverBoard = {
  settles_at: WEDNESDAY,
  my_priority: 4,
  order: [
    { team: "Chuck Wagon", priority: 1 },
    { team: "Brisket Brigade", priority: 2 },
    { team: "Filet Force", priority: 3 },
    { team: "Gridiron Butchers", priority: 4 },
    { team: "Prime Cut", priority: 5 },
  ],
  on_waivers: [
    { player_id: "w1", player: "Jaylen Wright", position: "RB", nfl_team: "MIA",
      dropped_at: "2026-09-07T18:20:00.000Z", clears_at: WEDNESDAY },
    { player_id: "w2", player: "Adonai Mitchell", position: "WR", nfl_team: "IND",
      dropped_at: "2026-09-08T01:05:00.000Z", clears_at: WEDNESDAY },
    { player_id: "w3", player: "Cade Otton", position: "TE", nfl_team: "TB",
      dropped_at: "2026-09-08T02:41:00.000Z", clears_at: WEDNESDAY },
  ],
  my_claims: [
    { claim_id: "c1", order: 1, add: "Jaylen Wright", add_player_id: "w1",
      drop: "Tyjae Spears", drop_player_id: "r3", status: "pending", outcome: null },
    { claim_id: "c2", order: 2, add: "Cade Otton", add_player_id: "w3",
      drop: null, drop_player_id: null, status: "pending", outcome: null },
  ],
  recent: [
    { ran_at: "2026-09-02T08:00:00.000Z", week: 1, seen: 7, awarded: 4 },
    { ran_at: "2026-08-26T08:00:00.000Z", week: 0, seen: 2, awarded: 2 },
  ],
};

const EMPTY: WaiverBoard = {
  settles_at: WEDNESDAY,
  my_priority: 4,
  order: FULL.order,
  on_waivers: [],
  my_claims: [],
  recent: [],
};

export default function PreviewWaivers() {
  const [empty, setEmpty] = useState(false);
  const [claiming, setClaiming] = useState<WaiverPlayer | null>(null);
  const board = empty ? EMPTY : FULL;

  return (
    <>
      <TopBar />
      <main className="page" data-width="narrow">
        <div className="card">
          <div className="card__head">
            <h2>Preview: the wire</h2>
            <div className="segmented">
              <button className="segmented__opt" data-on={!empty} onClick={() => setEmpty(false)}>Busy</button>
              <button className="segmented__opt" data-on={empty} onClick={() => setEmpty(true)}>Quiet</button>
            </div>
          </div>
        </div>

        <Wire
          board={board}
          teamName="Gridiron Butchers"
          busy={null}
          claimed={new Set(board.my_claims.map((c) => c.add_player_id))}
          onClaim={setClaiming}
          onCancelClaim={() => {}}
          onMove={() => {}}
        />
      </main>

      {claiming && (
        <ClaimSheet
          player={{ id: claiming.player_id, name: claiming.player }}
          roster={ROSTER}
          settlesAt={claiming.clears_at}
          busy={false}
          onCancel={() => setClaiming(null)}
          onSubmit={() => setClaiming(null)}
        />
      )}
    </>
  );
}
