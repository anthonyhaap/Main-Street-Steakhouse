"use client";

/**
 * Fixture harness for the player pool. Not linked from anywhere, reads no
 * database.
 *
 * The real tab needs a session and a drafted league. This is the same list
 * against an invented one: a dozen names of which most are on rosters, three
 * are free agents and one is on the wire — which is the shape the pool has
 * every week of the season, and the reason the list opens on who is
 * available. The one thing worth switching is whether the manager has room:
 * with a full roster, signing anybody opens the picker.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { Pool, type SignResult } from "@/components/players/Pool";
import type { Owned } from "@/components/players/DropPicker";
import type { PoolPlayer } from "@/lib/types";

const WEDNESDAY = "2026-09-16T08:00:00.000Z";

const player = (
  id: string, full_name: string, position: string, nfl_team: string | null, overall_rank: number,
): PoolPlayer => ({
  id, full_name, position, nfl_team, overall_rank,
  status: "ACT", adp: overall_rank + 0.4, bye_week: 7, position_rank: null, espn_id: null,
  injury_status: null, depth_chart_order: 1, proj_total: 200 - overall_rank, proj_remaining: 190 - overall_rank,
});

const POOL: PoolPlayer[] = [
  player("p1",  "Ja'Marr Chase",    "WR", "CIN", 1),
  player("p2",  "Bijan Robinson",   "RB", "ATL", 2),
  player("p3",  "Saquon Barkley",   "RB", "PHI", 3),
  player("p4",  "Trey McBride",     "TE", "ARI", 12),
  player("p5",  "Rome Odunze",      "WR", "CHI", 41),
  player("p6",  "Tyjae Spears",     "RB", "TEN", 88),
  player("p7",  "Adonai Mitchell",  "WR", "IND", 131),
  player("p8",  "Cade Otton",       "TE", "TB",  164),
  player("p9",  "Tyler Allgeier",   "RB", "ATL", 172),
  player("p10", "Jalen McMillan",   "WR", "TB",  186),
  player("p11", "Cam Little",       "K",  "JAX", 201),
  player("p12", "Broncos D/ST",     "DST", "DEN", 90),
];

const owned = (player_id: string, team_id: string, team: string): Owned => {
  const p = POOL.find((x) => x.id === player_id)!;
  return { player_id, player: p.full_name, position: p.position, nfl_team: p.nfl_team, team_id, team };
};

const OWNERS: Owned[] = [
  owned("p1",  "t2", "Prime Cut"),
  owned("p2",  "t3", "Chuck Wagon"),
  owned("p3",  "t2", "Prime Cut"),
  owned("p4",  "t1", "Gridiron Butchers"),
  owned("p5",  "t1", "Gridiron Butchers"),
  owned("p6",  "t1", "Gridiron Butchers"),
  owned("p12", "t3", "Chuck Wagon"),
];

// Cade Otton was dropped on Sunday night; he clears Wednesday.
const WAIVERS = new Map([["p8", WEDNESDAY]]);

export default function PreviewPlayers() {
  const [full, setFull] = useState(false);

  const sign = async (_add: PoolPlayer, dropId?: string): Promise<SignResult> =>
    full && !dropId ? "full" : "done";

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head">
            <h2>Preview: the pool</h2>
            <div className="segmented">
              <button className="segmented__opt" data-on={!full} onClick={() => setFull(false)}>Room</button>
              <button className="segmented__opt" data-on={full} onClick={() => setFull(true)}>Full roster</button>
            </div>
          </div>
        </div>

        <Pool
          pool={POOL}
          owners={OWNERS}
          waivers={WAIVERS}
          teamId="t1"
          busy={null}
          onSign={sign}
          onRelease={async () => {}}
          onClaim={async () => true}
        />
      </main>
    </>
  );
}
