"use client";

/**
 * Fixture harness for the draft pool. Not linked from anywhere.
 *
 * The ten rows below are a verbatim snapshot of `draft_pool` — real players,
 * real ESPN ids, real ADP, and the season projection as `ff_score` prices it
 * under this league's rules. Kept static so the list renders without a session
 * or a draft in progress.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { Pool } from "@/components/draft/Pool";
import { PlayerSheet } from "@/components/player/PlayerSheet";
import { CARD } from "@/app/preview/player/fixture";
import type { BoardPick, PoolPlayer } from "@/lib/types";

const POOL: PoolPlayer[] = [
  { id: "720b29cc-29c2-403d-8ffb-2b31ab17fa7e", full_name: "Jahmyr Gibbs", position: "RB", nfl_team: "DET", status: "ACT", adp: 1.5, overall_rank: 1, bye_week: 6, position_rank: 1, espn_id: "4429795", injury_status: null, depth_chart_order: 1, proj_total: 381.30, proj_remaining: 381.30 },
  { id: "8206827b-554a-46d8-a7b2-aa03689aa55b", full_name: "Bijan Robinson", position: "RB", nfl_team: "ATL", status: "ACT", adp: 2.2, overall_rank: 2, bye_week: 11, position_rank: 2, espn_id: "4430807", injury_status: null, depth_chart_order: 1, proj_total: 373.22, proj_remaining: 373.22 },
  { id: "b5b41230-f52a-448d-ac21-42a11bbe358f", full_name: "Puka Nacua", position: "WR", nfl_team: "LAR", status: "ACT", adp: 3.1, overall_rank: 3, bye_week: 11, position_rank: 1, espn_id: "4426515", injury_status: "Questionable", depth_chart_order: 1, proj_total: 351.52, proj_remaining: 351.52 },
  { id: "1defbf5f-706c-4f90-836a-45f17f3ab51f", full_name: "Ja'Marr Chase", position: "WR", nfl_team: "CIN", status: "ACT", adp: 3.8, overall_rank: 4, bye_week: 6, position_rank: 2, espn_id: "4362628", injury_status: "Questionable", depth_chart_order: 1, proj_total: 332.95, proj_remaining: 332.95 },
  { id: "40a0f498-2a47-4619-b451-1ccbea51254c", full_name: "Jaxon Smith-Njigba", position: "WR", nfl_team: "SEA", status: "ACT", adp: 5.5, overall_rank: 5, bye_week: 11, position_rank: 3, espn_id: "4430878", injury_status: null, depth_chart_order: 1, proj_total: 358.06, proj_remaining: 358.06 },
  { id: "66f4522e-a5c8-44c3-bcef-0fd36695bcfc", full_name: "Amon-Ra St. Brown", position: "WR", nfl_team: "DET", status: "ACT", adp: 6.4, overall_rank: 6, bye_week: 6, position_rank: 4, espn_id: "4374302", injury_status: null, depth_chart_order: 1, proj_total: 338.68, proj_remaining: 338.68 },
  { id: "c72adccf-bed4-4ab6-adce-1cdca8a5879b", full_name: "Christian McCaffrey", position: "RB", nfl_team: "SF", status: "ACT", adp: 6.6, overall_rank: 7, bye_week: 8, position_rank: 3, espn_id: "3117251", injury_status: "Questionable", depth_chart_order: 1, proj_total: 378.17, proj_remaining: 378.17 },
  { id: "0fffd218-f09d-425a-bab8-3dd1b241b741", full_name: "Jonathan Taylor", position: "RB", nfl_team: "IND", status: "ACT", adp: 7.5, overall_rank: 8, bye_week: 13, position_rank: 4, espn_id: "4242335", injury_status: null, depth_chart_order: 1, proj_total: 329.25, proj_remaining: 329.25 },
  { id: "7cda97eb-e84d-4129-898b-9bc0fe3441f8", full_name: "Drake London", position: "WR", nfl_team: "ATL", status: "ACT", adp: 10.1, overall_rank: 9, bye_week: 11, position_rank: 5, espn_id: "4426502", injury_status: null, depth_chart_order: 1, proj_total: 282.66, proj_remaining: 282.66 },
  { id: "e0fd9cd9-8412-4e6e-a126-4ab23ee28f04", full_name: "De'Von Achane", position: "RB", nfl_team: "MIA", status: "ACT", adp: 10.4, overall_rank: 10, bye_week: 6, position_rank: 5, espn_id: "4429160", injury_status: null, depth_chart_order: 1, proj_total: 293.94, proj_remaining: 293.94 },
];

const MY_PICKS: BoardPick[] = [
  {
    draft_id: "D", pick_number: 3, round: 1, is_autopick: false,
    made_at: new Date().toISOString(), team_id: "t1", team_name: "Gridiron Butchers",
    draft_slot: 3, player_id: "b5b41230-f52a-448d-ac21-42a11bbe358f",
    player_name: "Puka Nacua", position: "WR", nfl_team: "LAR", espn_id: "4426515",
  },
  {
    draft_id: "D", pick_number: 22, round: 2, is_autopick: true,
    made_at: new Date().toISOString(), team_id: "t1", team_name: "Gridiron Butchers",
    draft_slot: 3, player_id: "0fffd218-f09d-425a-bab8-3dd1b241b741",
    player_name: "Jonathan Taylor", position: "RB", nfl_team: "IND", espn_id: "4242335",
  },
];

export default function DraftPreviewPage() {
  const [queueIds, setQueueIds] = useState<string[]>([
    "c72adccf-bed4-4ab6-adce-1cdca8a5879b",
    "40a0f498-2a47-4619-b451-1ccbea51254c",
  ]);
  const [openId, setOpenId] = useState<string | null>(null);
  const drafted = new Set(MY_PICKS.map((p) => p.player_id));
  const takenBy = new Map(MY_PICKS.map((p) => [p.player_id, p.team_name]));

  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> Ten real rows straight out of <code>draft_pool</code>,
        with the season projection priced under this league&apos;s rules. Click any name
        for the in-room card; it shows the player fixture regardless of who was clicked.
      </div>
      <main className="page" data-width="narrow">
        <Pool
          pool={POOL}
          draftedIds={drafted}
          takenBy={takenBy}
          slots={["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BN", "BN", "BN", "BN", "BN", "BN"]}
          onOpen={setOpenId}
          queue={queueIds.map((id) => POOL.find((p) => p.id === id)!).filter(Boolean)}
          myPicks={MY_PICKS}
          needs={["QB", "TE", "K", "DST"]}
          canPick
          busy={false}
          onDraft={() => {}}
          onQueueChange={setQueueIds}
        />
      </main>
      {openId && (
        <PlayerSheet
          playerId={openId}
          card={CARD}
          onClose={() => setOpenId(null)}
          actions={
            <>
              <button className="btn" data-size="sm">Queue</button>
              <button className="btn" data-v="primary" data-size="sm">Draft Mahomes</button>
            </>
          }
        />
      )}
    </>
  );
}
