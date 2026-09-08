"use client";

/**
 * Fixture harness for the television. Not linked from anywhere.
 *
 * A draft only happens once, on a night, and the screen it is being built for
 * is somebody's living room. This runs the four states that screen has to be
 * right in — before the first pick, mid-round with a steal on the board, the
 * last fifteen seconds, and the moment it is over — with no session and no
 * draft.
 */

import { useState } from "react";
import { TvBoard, type TvState } from "@/components/draft/TvBoard";
import { snakeSlot } from "@/lib/draft";
import type { BoardPick, Draft, PoolPlayer, Team } from "@/lib/types";

const TEAMS: Team[] = [
  "Gridiron Butchers", "Prime Cut", "Dry Aged Dynasty", "The Porterhouse",
  "Bone-In Bandits", "Wagyu Warriors", "Tomahawk Chop", "Filet Force",
  "Sirloin Syndicate", "Ribeye Renegades", "Brisket Brigade", "Chuck Wagon",
].map((name, i) => ({
  id: `t${i + 1}`, league_id: "L", name,
  owner_id: null, owner_email: null,
  manager_name: ["Anthony", "Marcus", "Dev", "Ray", "Tom", "Nate",
                 "Jules", "Sam", "Kai", "Priya", "Owen", "Mike"][i],
  logo_path: null, draft_slot: i + 1,
}));

/** Names invented; the point is the shape of a pick, not who was in it. */
const PICKED: [string, string, string][] = [
  ["Bijan Robinson", "RB", "ATL"], ["Ja'Marr Chase", "WR", "CIN"],
  ["CeeDee Lamb", "WR", "DAL"], ["Breece Hall", "RB", "NYJ"],
  ["Amon-Ra St. Brown", "WR", "DET"], ["Jahmyr Gibbs", "RB", "DET"],
  ["Garrett Wilson", "WR", "NYJ"], ["Sam LaPorta", "TE", "DET"],
  ["Puka Nacua", "WR", "LAR"], ["Saquon Barkley", "RB", "PHI"],
  ["Nico Collins", "WR", "HOU"], ["Drake London", "WR", "ATL"],
  ["De'Von Achane", "RB", "MIA"], ["Malik Nabers", "WR", "NYG"],
  ["Brock Bowers", "TE", "LV"], ["Josh Jacobs", "RB", "GB"],
  ["Ladd McConkey", "WR", "LAC"], ["Kyren Williams", "RB", "LAR"],
  ["Tee Higgins", "WR", "CIN"], ["James Cook", "RB", "BUF"],
  ["Jayden Daniels", "QB", "WAS"], ["Trey McBride", "TE", "ARI"],
  ["Chase Brown", "RB", "CIN"], ["Terry McLaurin", "WR", "WAS"],
  ["Josh Allen", "QB", "BUF"], ["Bucky Irving", "RB", "TB"],
  ["Courtland Sutton", "WR", "DEN"], ["George Kittle", "TE", "SF"],
  ["Jordan Addison", "WR", "MIN"], ["Aaron Jones", "RB", "MIN"],
];

/** The same snake the room uses, rather than a second copy of the rule. */
function picks(n: number): BoardPick[] {
  return PICKED.slice(0, n).map(([player_name, position, nfl_team], i) => {
    const pick = i + 1;
    const team = TEAMS[snakeSlot(pick, TEAMS.length) - 1];
    return {
      pick_id: `dp${pick}`, draft_id: "d1", pick_number: pick, round: Math.ceil(pick / TEAMS.length),
      is_autopick: false, made_at: new Date().toISOString(),
      team_id: team.id, team_name: team.name, draft_slot: team.draft_slot,
      player_id: `p${pick}`, player_name, position, nfl_team, espn_id: null,
    };
  });
}

/**
 * Market ranks: everybody goes about where the market had them, except the
 * thirtieth pick, who the market had fourth and who was still sitting there
 * in the third round. delta is +26, which clears the Steal threshold of 24 —
 * and a steal is the thing a room actually turns round and looks at the
 * television for.
 */
const POOL = new Map<string, PoolPlayer>(
  PICKED.map(([full_name, position], i) => [
    `p${i + 1}`,
    { id: `p${i + 1}`, full_name, position, adp: i === 29 ? 4 : i + 1, overall_rank: i + 1 } as PoolPlayer,
  ]),
);

const draft = (over: Partial<Draft>): Draft => ({
  id: "d1", league_id: "L", status: "active", type: "snake", rounds: 15,
  pick_seconds: 90, current_pick: 31, pick_deadline: null, remaining_ms: null,
  started_at: new Date().toISOString(), completed_at: null,
  ...over,
});

/** What eleven phones said about the steal. */
const REACTS = { "dp30": [
  { emoji: "🔥", count: 7, mine: true },
  { emoji: "💀", count: 3, mine: false },
] };

type Stage = { key: string; label: string; state: TvState; msLeft: number | null };

const STAGES: Stage[] = [
  {
    key: "before", label: "Before the first pick",
    state: { draft: draft({ status: "setup", current_pick: 1 }), picks: [], teams: TEAMS },
    msLeft: null,
  },
  {
    key: "steal", label: "A steal on the board",
    state: { draft: draft({ current_pick: 31 }), picks: picks(30), teams: TEAMS, reactions: REACTS },
    msLeft: 63_000,
  },
  {
    key: "urgent", label: "Fifteen seconds left",
    state: { draft: draft({ current_pick: 31 }), picks: picks(30), teams: TEAMS },
    msLeft: 9_000,
  },
  {
    key: "paused", label: "Paused",
    state: { draft: draft({ status: "paused", current_pick: 31 }), picks: picks(30), teams: TEAMS },
    msLeft: null,
  },
  {
    key: "done", label: "The board is full",
    state: {
      draft: draft({ status: "complete", current_pick: 181, rounds: 15 }),
      picks: picks(30), teams: TEAMS,
    },
    msLeft: null,
  },
];

export default function DraftTvPreview() {
  const [key, setKey] = useState(STAGES[1].key);
  const stage = STAGES.find((s) => s.key === key) ?? STAGES[1];

  return (
    <>
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        position: "relative", zIndex: 3,
      }}>
        <strong>Fixture.</strong>
        <div className="segmented" style={{ width: "max-content" }}>
          {STAGES.map((s) => (
            <button key={s.key} className="segmented__opt" data-on={s.key === key}
                    onClick={() => setKey(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* The real page is fixed to the viewport; here it sits under the switch
          so both are usable. */}
      <div style={{ position: "relative", height: "calc(100vh - 56px)" }}>
        <div className="tv-page" style={{ position: "absolute" }}>
          <TvBoard state={stage.state} msLeft={stage.msLeft} poolById={POOL}
                   reactions={stage.state.reactions} />
        </div>
      </div>
    </>
  );
}
