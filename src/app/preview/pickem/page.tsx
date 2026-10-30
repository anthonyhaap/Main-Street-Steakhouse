"use client";

/**
 * Fixture harness for the Pick'em board. Reads no database.
 *
 * One game in each state the card draws — open, picked, live with your pick,
 * live with none, and final both ways — so the layout can be looked at on a
 * phone without a session or a Sunday. Picking works, locally.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { GameCard } from "@/components/pickem/GameCard";
import type { PickemGame, PickemPick } from "@/lib/pickem/types";

const LATER = "2026-11-01T18:00:00Z";
const PICKS: PickemPick[] = [
  { user_id: "u1", display_name: "You", selected_team: "KC" },
  { user_id: "u2", display_name: "Bo", selected_team: "BUF" },
  { user_id: "u3", display_name: "Dave", selected_team: "KC" },
];

const base = (over: Partial<PickemGame> & Pick<PickemGame, "game_id" | "away_team" | "home_team">): PickemGame => ({
  kickoff_at: LATER, status: "pre", status_detail: null, home_score: null, away_score: null,
  locked: false, winner: null, my_pick: null, picks: null, distribution: null, ...over,
});

const GAMES: PickemGame[] = [
  base({ game_id: "g1", away_team: "BUF", home_team: "KC", status: "post", status_detail: "Final",
    away_score: 20, home_score: 27, locked: true, winner: "KC", my_pick: "KC", picks: PICKS, distribution: { KC: 8, BUF: 4 } }),
  base({ game_id: "g2", away_team: "DAL", home_team: "PHI", status: "post", status_detail: "Final",
    away_score: 24, home_score: 20, locked: true, winner: "DAL", my_pick: "PHI", picks: PICKS, distribution: { PHI: 9, DAL: 3 } }),
  base({ game_id: "g3", away_team: "SF", home_team: "LAR", status: "in", status_detail: "Q3 8:14",
    away_score: 13, home_score: 17, locked: true, my_pick: "SF", picks: PICKS, distribution: { SF: 7, LAR: 5 } }),
  base({ game_id: "g4", away_team: "GB", home_team: "MIN", status: "in", status_detail: "Q2 1:02",
    away_score: 7, home_score: 3, locked: true, picks: PICKS, distribution: { GB: 6, MIN: 5 } }),
  base({ game_id: "g5", away_team: "CIN", home_team: "BAL", my_pick: "BAL" }),
  base({ game_id: "g6", away_team: "DET", home_team: "CHI" }),
  base({ game_id: "g7", away_team: "SEA", home_team: "ARI" }),
  base({ game_id: "g8", away_team: "NYJ", home_team: "MIA" }),
];

export default function PreviewPickem() {
  const [games, setGames] = useState(GAMES);
  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head"><h2>Preview: Pick&apos;em</h2></div>
        </div>
        <div className="grid-auto">
          {games.map((g) => (
            <GameCard key={g.game_id} game={g} members={12} busy={false}
              onPick={(team) => setGames((list) => list.map((x) => (x.game_id === g.game_id ? { ...x, my_pick: team } : x)))} />
          ))}
        </div>
      </main>
    </>
  );
}
