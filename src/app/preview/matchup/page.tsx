"use client";

/**
 * Fixture harness for one matchup on its own screen. Not linked from anywhere.
 *
 * The same invented Sunday `/preview/matchups` runs on, seen the way
 * `/matchups/[id]` sees it: one game, the rail along the top, the header that
 * collapses into a bar, the lineups with their stat lines behind a tap, and
 * the benches underneath.
 *
 * Everything the live route does with a session and a database it does here
 * with state: picking off the rail is the same `onPick` the live page hands
 * the navigator, and the thread is `TalkThread` with no `onSend`, which is the
 * read-only one a signed-out reader gets.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { VsLineups } from "@/components/Scoreboard";
import { MatchupHead } from "@/components/matchup/MatchupHead";
import { MatchupPager, useSwipe } from "@/components/matchup/MatchupPager";
import { TalkThread } from "@/components/matchup/Talk";
import { board, NOW, THREAD, STAGES, type Stage } from "@/lib/fixtures/sunday";
import { cardLine } from "@/lib/scoreboard";

export default function MatchupPreviewPage() {
  const [stage, setStage] = useState<Stage>("late");
  const b = board(stage);
  const [id, setId] = useState(b.matchups[0].id);
  const card = b.matchups.find((m) => m.id === id) ?? b.matchups[0];
  const note = STAGES.find((s) => s.key === stage)!.note;

  const step = (by: 1 | -1) => {
    const at = b.matchups.findIndex((m) => m.id === card.id);
    const to = b.matchups[at + by];
    if (to) setId(to.id);
  };
  const swipe = useSwipe(() => step(-1), () => step(1));

  return (
    <>
      <TopBar status="live" />

      <div className="mv-stick">
        <MatchupPager board={b} currentId={card.id} onPick={setId} />
      </div>

      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> One game of an invented Sunday, on a fixed clock. Real
        players and real ESPN ids; the teams, scores, projections and lineups are invented.
      </div>

      <main className="page mv" {...swipe}>
        <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {STAGES.map((s) => (
              <button key={s.key} className="segmented__opt" data-on={s.key === stage}
                      onClick={() => setStage(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <p className="prose" style={{ margin: 0, fontSize: "var(--t-small)" }}>{note}</p>

        <MatchupHead key={card.id} c={card} now={NOW} />
        <p className="mv__line">{cardLine(card, b.my_team_id)}</p>

        <VsLineups away={card.away} home={card.home} now={NOW} bench head={null} />

        <div className="sb__talk">
          <TalkThread
            messages={card.talk.count > 0 ? THREAD : []}
            now={NOW}
            emptyLine="Nobody has said anything about this one yet."
          />
        </div>
      </main>
    </>
  );
}
