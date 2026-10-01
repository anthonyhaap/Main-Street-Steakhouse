"use client";

/**
 * Fixture harness for the ledger. Not linked from anywhere, reads no database.
 *
 * The real screen needs a drafted league that has actually traded and settled
 * waivers, which is more than a test can arrange. This is the same component
 * against an invented week, so the sentences can be asserted — and it carries
 * one of every shape the ledger has to write: a plain signing, a release, a
 * signing that released somebody in the same move, a waiver claim with and
 * without a drop, and a two-for-one trade.
 *
 * Dates are relative to load so the "Today" and "Yesterday" headings are
 * exercised rather than frozen into a date nobody is on.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { Ledger, type LedgerFilter } from "@/components/ledger/Ledger";
import { teamIdsByName } from "@/lib/team-link";
import type { LedgerEntry } from "@/lib/types";

/* Anchored to local midnight rather than to "hours ago", which is not the same
 * thing after 1am: two hours before 01:05 is yesterday, and the Today heading
 * this fixture exists to show simply would not be there. Anything built from
 * `midnight` lands on the day it says it does, at any hour. */
const NOW = new Date();
const MIDNIGHT = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();

/**
 * Earlier today, as a time of day rather than a span before now.
 *
 * It was `NOW - minutesAgo`, and that made this page's HTML depend on the clock
 * at the moment the module was evaluated — which, for a prerendered page, is the
 * moment of the *build*. The browser re-rendered it at load against its own
 * clock, the printed minute had moved on, and React reported the text hydration
 * mismatch it should: the server said 1:58 AM and the client said 2:01. The run
 * went red on a page whose content nobody had touched, and it only showed up at
 * all once a minute boundary happened to fall between the build and the test.
 *
 * The note above already states the rule — anything built from `midnight` lands
 * on the day it says it does, at any hour — and this was the one helper not
 * keeping it. An offset from local midnight is the same on both sides of
 * hydration for as long as the calendar day lasts, which outlives any run.
 */
const today = (hour: number, minute = 0) =>
  new Date(MIDNIGHT + hour * 3600_000 + minute * 60_000).toISOString();
/** Always yesterday: 1-24 hours before today began. */
const yesterday = (hoursBeforeMidnight: number) =>
  new Date(MIDNIGHT - hoursBeforeMidnight * 3600_000).toISOString();
/** Comfortably older, so it gets a dated heading of its own. */
const daysBack = new Date(MIDNIGHT - 30 * 3600_000).toISOString();

const BUTCHERS = "Gridiron Butchers";
const CHUCK = "Chuck Wagon";
const BRISKET = "Brisket Brigade";

const ENTRIES: LedgerEntry[] = [
  {
    id: "x6", kind: "trade", week: 3, created_at: today(14, 20), ord: 6,
    items: [
      { player_id: "p1", player: "Ja'Marr Chase", position: "WR", nfl_team: "CIN", from_team: BUTCHERS, to_team: CHUCK },
      { player_id: "p2", player: "Bijan Robinson", position: "RB", nfl_team: "ATL", from_team: CHUCK, to_team: BUTCHERS },
      { player_id: "p3", player: "Jake Ferguson", position: "TE", nfl_team: "DAL", from_team: CHUCK, to_team: BUTCHERS },
    ],
  },
  {
    id: "x5", kind: "waiver", week: 3, created_at: today(10, 5), ord: 5,
    items: [
      { player_id: "p4", player: "Tyjae Spears", position: "RB", nfl_team: "TEN", from_team: BRISKET, to_team: null },
      { player_id: "p5", player: "Jaylen Wright", position: "RB", nfl_team: "MIA", from_team: null, to_team: BRISKET },
    ],
  },
  {
    id: "x4", kind: "waiver", week: 3, created_at: today(10, 5), ord: 4,
    items: [
      { player_id: "p6", player: "Cade Otton", position: "TE", nfl_team: "TB", from_team: null, to_team: CHUCK },
    ],
  },
  {
    id: "x3", kind: "add_drop", week: 2, created_at: yesterday(3), ord: 3,
    items: [
      { player_id: "p7", player: "Roschon Johnson", position: "RB", nfl_team: "CHI", from_team: BUTCHERS, to_team: null },
      { player_id: "p8", player: "Rome Odunze", position: "WR", nfl_team: "CHI", from_team: null, to_team: BUTCHERS },
    ],
  },
  {
    id: "x2", kind: "drop", week: 2, created_at: yesterday(6), ord: 2,
    items: [
      { player_id: "p9", player: "Adonai Mitchell", position: "WR", nfl_team: "IND", from_team: CHUCK, to_team: null },
    ],
  },
  {
    id: "x1", kind: "add", week: 1, created_at: daysBack, ord: 1,
    items: [
      { player_id: "p10", player: "Tank Bigsby", position: "RB", nfl_team: "JAX", from_team: null, to_team: BRISKET },
    ],
  },
];

/**
 * The invented league behind the invented week, so the names in these sentences
 * can be resolved to desks the way the real screen resolves them against the
 * session. `BRISKET` is deliberately left out: a team the list cannot place —
 * one that has been renamed since the move, in the real thing — must still read
 * as plain text, and this is where that is asserted.
 */
const TEAMS = [
  { id: "t1", name: BUTCHERS },
  { id: "t4", name: CHUCK },
];
const teamIdOf = teamIdsByName(TEAMS);

export default function PreviewLedger() {
  const [empty, setEmpty] = useState(false);
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [team, setTeam] = useState("");
  const entries = empty ? [] : ENTRIES;

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head">
            <h2>Preview: the ledger</h2>
            <div className="segmented">
              <button className="segmented__opt" data-on={!empty} onClick={() => setEmpty(false)}>Busy</button>
              <button className="segmented__opt" data-on={empty} onClick={() => setEmpty(true)}>Quiet</button>
            </div>
          </div>
        </div>

        <Ledger
          entries={entries}
          filter={filter}
          team={team}
          teams={[BRISKET, CHUCK, BUTCHERS]}
          onFilter={setFilter}
          onTeam={setTeam}
          teamIdOf={teamIdOf}
          myTeamId="t4"
        />
      </main>
    </>
  );
}
