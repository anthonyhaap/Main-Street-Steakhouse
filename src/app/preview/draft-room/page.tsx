"use client";

/**
 * Fixture harness for the whole draft room. Not linked from anywhere.
 *
 * The room is the one screen that can't be inspected without a session, a
 * draft in progress and eleven other people — which is exactly why its layout
 * kept regressing on phones. This renders the real components against static
 * data: same clock, ticker, board, rosters and pool as draft night, at any
 * window size, with nobody on the clock but you.
 */

import { useMemo, useState } from "react";
import { TopBar } from "@/components/Shell";
import { Clock } from "@/components/draft/Clock";
import { Board } from "@/components/draft/Board";
import { Pool, type PoolTab } from "@/components/draft/Pool";
import { Rosters } from "@/components/draft/Rosters";
import { Ticker } from "@/components/draft/Ticker";
import { rosterNeeds, snakeSlot, teamAtPick } from "@/lib/draft";
import type { BoardPick, Draft, PoolPlayer, Team } from "@/lib/types";

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BN", "BN", "BN", "BN", "BN", "BN"];
const TEAM_COUNT = 12;
const CURRENT_PICK = 27;

const NAMES = [
  "Gridiron Butchers", "Prime Cut", "Dry Aged Dynasty", "The Porterhouse",
  "Bone-In Bandits", "Wagyu Warriors", "Tomahawk Chop", "Filet Force",
  "Sirloin Syndicate", "Ribeye Renegades", "Brisket Brigade", "Chuck Wagon",
];

const TEAMS: Team[] = NAMES.map((name, i) => ({
  id: `t${i + 1}`, league_id: "L", name, owner_id: `u${i}`, owner_email: null,
  manager_name: null, logo_path: null, draft_slot: i + 1,
}));

/** Ten verbatim `draft_pool` rows, then enough filler to fill a board. */
const REAL: PoolPlayer[] = [
  { id: "p1", full_name: "Jahmyr Gibbs", position: "RB", nfl_team: "DET", status: "ACT", adp: 1.5, overall_rank: 1, bye_week: 6, position_rank: 1, espn_id: "4429795", injury_status: null, depth_chart_order: 1, proj_total: 381.3, proj_remaining: 381.3 },
  { id: "p2", full_name: "Bijan Robinson", position: "RB", nfl_team: "ATL", status: "ACT", adp: 2.2, overall_rank: 2, bye_week: 11, position_rank: 2, espn_id: "4430807", injury_status: null, depth_chart_order: 1, proj_total: 373.2, proj_remaining: 373.2 },
  { id: "p3", full_name: "Puka Nacua", position: "WR", nfl_team: "LAR", status: "ACT", adp: 3.1, overall_rank: 3, bye_week: 11, position_rank: 1, espn_id: "4426515", injury_status: "Questionable", depth_chart_order: 1, proj_total: 351.5, proj_remaining: 351.5 },
  { id: "p4", full_name: "Ja'Marr Chase", position: "WR", nfl_team: "CIN", status: "ACT", adp: 3.8, overall_rank: 4, bye_week: 6, position_rank: 2, espn_id: "4362628", injury_status: null, depth_chart_order: 1, proj_total: 333.0, proj_remaining: 333.0 },
  { id: "p5", full_name: "Jaxon Smith-Njigba", position: "WR", nfl_team: "SEA", status: "ACT", adp: 5.5, overall_rank: 5, bye_week: 11, position_rank: 3, espn_id: "4430878", injury_status: null, depth_chart_order: 1, proj_total: 358.1, proj_remaining: 358.1 },
  { id: "p6", full_name: "Amon-Ra St. Brown", position: "WR", nfl_team: "DET", status: "ACT", adp: 6.4, overall_rank: 6, bye_week: 6, position_rank: 4, espn_id: "4374302", injury_status: null, depth_chart_order: 1, proj_total: 338.7, proj_remaining: 338.7 },
  { id: "p7", full_name: "Christian McCaffrey", position: "RB", nfl_team: "SF", status: "ACT", adp: 6.6, overall_rank: 7, bye_week: 8, position_rank: 3, espn_id: "3117251", injury_status: "Questionable", depth_chart_order: 1, proj_total: 378.2, proj_remaining: 378.2 },
  { id: "p8", full_name: "Jonathan Taylor", position: "RB", nfl_team: "IND", status: "ACT", adp: 7.5, overall_rank: 8, bye_week: 13, position_rank: 4, espn_id: "4242335", injury_status: null, depth_chart_order: 1, proj_total: 329.3, proj_remaining: 329.3 },
  { id: "p9", full_name: "Drake London", position: "WR", nfl_team: "ATL", status: "ACT", adp: 10.1, overall_rank: 9, bye_week: 11, position_rank: 5, espn_id: "4426502", injury_status: null, depth_chart_order: 1, proj_total: 282.7, proj_remaining: 282.7 },
  { id: "p10", full_name: "De'Von Achane", position: "RB", nfl_team: "MIA", status: "ACT", adp: 10.4, overall_rank: 10, bye_week: 6, position_rank: 5, espn_id: "4429160", injury_status: null, depth_chart_order: 1, proj_total: 293.9, proj_remaining: 293.9 },
];

const CLUBS = ["BUF", "KC", "PHI", "DAL", "GB", "BAL", "SF", "MIN", "HOU", "NYJ", "TB", "LAC"];
const SHAPE = ["RB", "WR", "WR", "RB", "TE", "WR", "QB", "RB", "WR", "TE", "QB", "K", "DST"];

const FILLER: PoolPlayer[] = Array.from({ length: 190 }, (_, i) => {
  const n = i + 11;
  const position = SHAPE[i % SHAPE.length];
  return {
    id: `f${n}`,
    full_name: `${["Marcus", "Devin", "Ray", "Tyler", "Isaiah", "Cade", "Jalen", "Bo"][i % 8]} ${["Ellery", "Vaughn", "Kessler", "Pratt", "Doyle", "Rhodes", "Barnett", "Whitfield"][(i * 3) % 8]}`,
    position,
    nfl_team: CLUBS[i % CLUBS.length],
    status: "ACT",
    adp: n + (i % 5) - 2,
    overall_rank: n,
    bye_week: 5 + (i % 9),
    position_rank: Math.floor(i / SHAPE.length) + 1,
    espn_id: null,
    injury_status: i % 17 === 0 ? "Questionable" : null,
    depth_chart_order: 1,
    proj_total: Math.round(320 - n * 1.1),
    proj_remaining: Math.round(320 - n * 1.1),
  };
});

const POOL = [...REAL, ...FILLER];

/** The first 26 picks, straight down the snake off the top of the board. */
const PICKS: BoardPick[] = Array.from({ length: CURRENT_PICK - 1 }, (_, i) => {
  const pickNumber = i + 1;
  const slot = snakeSlot(pickNumber, TEAM_COUNT);
  const team = TEAMS[slot - 1];
  // Not strictly in rank order — a couple of reaches so the grade dots show.
  const player = POOL[(i * 7 + 3) % 44];
  return {
    draft_id: "D", pick_number: pickNumber, round: Math.floor(i / TEAM_COUNT) + 1,
    is_autopick: pickNumber % 9 === 0, made_at: new Date().toISOString(),
    team_id: team.id, team_name: team.name, draft_slot: slot,
    player_id: player.id, player_name: player.full_name, position: player.position,
    nfl_team: player.nfl_team, espn_id: player.espn_id,
  };
}).filter((p, i, all) => all.findIndex((x) => x.player_id === p.player_id) === i);

const DRAFT: Draft = {
  id: "D", league_id: "L", status: "active", type: "snake", rounds: 15,
  pick_seconds: 90, current_pick: CURRENT_PICK,
  pick_deadline: new Date(Date.now() + 47000).toISOString(),
  remaining_ms: null, started_at: new Date(Date.now() - 3.4e6).toISOString(), completed_at: null,
};

type View = "pool" | "board" | "teams";

const VIEWS: { key: View; label: string; poolTab?: PoolTab }[] = [
  { key: "pool", label: "Players", poolTab: "available" },
  { key: "pool", label: "Queue", poolTab: "queue" },
  { key: "pool", label: "Roster", poolTab: "roster" },
  { key: "board", label: "Board" },
  { key: "teams", label: "Teams" },
];

const MY_TEAM = TEAMS[2];

export default function DraftRoomPreview() {
  const [view, setView] = useState<View>("pool");
  const [leftView, setLeftView] = useState<"board" | "teams">("board");
  const [poolTab, setPoolTab] = useState<PoolTab>("available");
  const [queueIds, setQueueIds] = useState<string[]>(["p1", "p5", "f14"]);
  const [muted, setMuted] = useState(false);

  const byId = useMemo(() => new Map(POOL.map((p) => [p.id, p])), []);
  const draftedIds = useMemo(() => new Set(PICKS.map((p) => p.player_id)), []);
  const takenBy = useMemo(() => new Map(PICKS.map((p) => [p.player_id, p.team_name])), []);
  const myPicks = useMemo(() => PICKS.filter((p) => p.team_id === MY_TEAM.id), []);
  const queue = useMemo(() => queueIds.map((id) => byId.get(id)).filter(Boolean) as PoolPlayer[], [byId, queueIds]);
  const needs = useMemo(() => rosterNeeds(SLOTS, myPicks), [myPicks]);

  return (
    <>
      <TopBar status="live" />
      <main className="page" data-layout="room">
        <div className="draft-room">
          <Clock
            draft={DRAFT}
            onClock={teamAtPick(CURRENT_PICK, TEAMS, TEAM_COUNT)}
            nextUp={teamAtPick(CURRENT_PICK + 1, TEAMS, TEAM_COUNT)}
            myTeamId={MY_TEAM.id}
            teamCount={TEAM_COUNT}
            msLeft={47000}
            picksUntilMine={4}
            myUpcoming={[31, 42, 55]}
            isCommissioner
            busy={false}
            onStart={() => {}} onPause={() => {}} onResume={() => {}}
            onUndo={() => {}} onReset={() => {}}
            soundMuted={muted}
            onToggleSound={() => setMuted((m) => !m)}
          />

          <Ticker picks={PICKS} poolById={byId} myTeamId={MY_TEAM.id} teamCount={TEAM_COUNT} onOpen={() => {}} />

          <div className="draft-tabs draft-only-narrow">
            <div className="segmented">
              {VIEWS.map((v) => {
                const on = v.key === "pool" ? view === "pool" && poolTab === v.poolTab : view === v.key;
                const count = v.poolTab === "queue" ? queue.length : v.poolTab === "roster" ? myPicks.length : 0;
                return (
                  <button key={v.label} className="segmented__opt" data-on={on}
                    onClick={() => {
                      setView(v.key);
                      if (v.key === "pool") setPoolTab(v.poolTab ?? "available");
                      else setLeftView(v.key as "board" | "teams");
                    }}>
                    {v.label}{count ? <i className="pool__scarce num">{count}</i> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="draft-tabs draft-only-wide">
            <div className="segmented">
              {(["board", "teams"] as const).map((v) => (
                <button key={v} className="segmented__opt" data-on={leftView === v}
                  onClick={() => { setLeftView(v); if (view !== "pool") setView(v); }}>
                  {v === "board" ? "The board" : "Team rosters"}
                </button>
              ))}
            </div>
          </div>

          <div className="draft-grid">
            <div className="draft-pane" data-show={view !== "pool"}>
              {leftView === "teams" ? (
                <Rosters teams={TEAMS} picks={PICKS} myTeamId={MY_TEAM.id} slots={SLOTS} poolById={byId}
                  teamCount={TEAM_COUNT} rounds={DRAFT.rounds} currentPick={CURRENT_PICK} />
              ) : (
                <Board draft={DRAFT} teams={TEAMS} picks={PICKS} myTeamId={MY_TEAM.id} poolById={byId} />
              )}
            </div>
            <div className="draft-pane" data-show={view === "pool"}>
              <Pool
                pool={POOL}
                currentPick={CURRENT_PICK}
                draftedIds={draftedIds}
                takenBy={takenBy}
                allPicks={PICKS}
                queue={queue}
                myPicks={myPicks}
                slots={SLOTS}
                needs={needs}
                tab={poolTab}
                onTabChange={setPoolTab}
                canPick
                busy={false}
                onDraft={() => {}}
                onQueueChange={setQueueIds}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
