"use client";

/**
 * Fixture harness for the Sunday board. Not linked from anywhere.
 *
 * The live page needs a session, a completed draft, a week with rosters in it
 * and football actually happening, which is why this screen went unlooked-at
 * for so long. The invented afternoon it runs on lives in
 * `@/lib/fixtures/sunday` — shared with `/preview/matchup`, which is the same
 * Sunday seen one game at a time — and the switch at the top runs it forward.
 */

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { Scoreboard } from "@/components/Scoreboard";
import { TalkThread } from "@/components/matchup/Talk";
import { Rivalry } from "@/components/matchup/Rivalry";
import { careerEvents } from "@/lib/fixtures/career";
import { rivalrySundays } from "@/lib/sundayline";
import { AroundTheHouse } from "@/components/matchup/AroundTheHouse";
import { ScoreTicker } from "@/components/matchup/ScoreTicker";
import { scoreCardText } from "@/lib/share";
import { board, NOW, RIVALRIES, STAGES, THREAD, type Stage } from "@/lib/fixtures/sunday";
import { freshness, slateLine, talkTeaser, type ScoreCard } from "@/lib/scoreboard";


/**
 * The Sundays these teams have stored: Ray (t3) and Dev (t4) swapped the lead
 * three times in week 5, the last of them late, on Goff's monster game; Marcus
 * (t1) came back on Anthony (t2) in week 6. Nate and Tom have never met.
 */
const NAMES: Record<string, string> = { t1: "Marcus", t2: "Anthony", t3: "Ray", t4: "Dev" };
const CAREER = careerEvents([
  [5, "lead", "t4", "t3"], [5, "lead", "t3", "t4"], [5, "late", "t4", "t3"],
  [5, "monster", "t4", "t3", { player: "Jared Goff", points: 32.5 }],
  [6, "lead", "t1", "t2"], [6, "comeback", "t1", "t2", { down: 18.2 }],
], (id) => NAMES[id]);

/** The closed line and, opened, the thread — with no way to post from here. */
function FixtureTalk({ card }: { card: ScoreCard }) {
  const [open, setOpen] = useState(card.talk.count > 0);
  const messages = card.talk.count > 0 ? THREAD : [];
  return (
    <div className="sb__talk">
      <button className="sb__talk-open" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <MessageCircle size={14} />
        <span className="sb__talk-label">Table talk</span>
        {card.talk.count > 0 && <span className="sb__talk-n">{card.talk.count}</span>}
        <span className="sb__talk-teaser">{talkTeaser(card.talk)}</span>
      </button>
      {open && (
        <TalkThread
          messages={messages}
          now={NOW}
          emptyLine="Nobody has said anything about this one yet."
        />
      )}
    </div>
  );
}

export default function MatchupsPreviewPage() {
  const [stage, setStage] = useState<Stage>("late");
  const [tab, setTab] = useState<"board" | "house">("board");
  // The fixture must not open a share sheet or touch the clipboard, so it
  // shows what would have been sent instead.
  const [sent, setSent] = useState<string | null>(null);
  const b = board(stage);
  const note = STAGES.find((s) => s.key === stage)!.note;

  return (
    <>
      <TopBar status="live" />
      <ScoreTicker board={b} />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> Three games on a fixed Sunday clock. Real players and
        real ESPN ids; the teams, scores, projections and lineups are invented.
      </div>

      <main className="page sb-board">
        <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {STAGES.map((s) => (
              <button key={s.key} className="segmented__opt" data-on={s.key === stage} onClick={() => setStage(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p className="prose" style={{ margin: 0, fontSize: "var(--t-small)" }}>{note}</p>

        <div className="sb-slate">
          <p>{slateLine(b.games, NOW)}</p>
          <span className="sb-slate__fresh">
            Scores <b>{freshness(b.stats_updated_at, NOW)}</b>
            {` · projections ${freshness(b.projections_updated_at, NOW)}`}
          </span>
        </div>

        <div className="segmented" style={{ width: "max-content", marginBottom: "var(--s4)" }}>
          <button className="segmented__opt" data-on={tab === "board"} onClick={() => setTab("board")}>
            The board
          </button>
          <button className="segmented__opt" data-on={tab === "house"} onClick={() => setTab("house")}>
            Around the house
          </button>
        </div>

        {tab === "house" && <AroundTheHouse board={b} />}

        {sent && (
          <pre className="note" data-kind="info" style={{ whiteSpace: "pre-wrap", marginBottom: "var(--s4)" }}>
            {sent}
          </pre>
        )}

        {tab === "board" && <Scoreboard
          board={b}
          onShare={(c) => setSent(scoreCardText(c, "Main Street Steakhouse", b.week, "https://steakhouse.football"))}
          now={NOW}
          talk={(c) => <FixtureTalk card={c} />}
          rivalry={(c) => {
            const card = RIVALRIES[c.id];
            if (!card) return null;
            const mine = b.my_team_id === c.home.team_id ? c.home
              : b.my_team_id === c.away.team_id ? c.away : null;
            return <Rivalry card={card} me={mine && (mine.manager_name?.trim() || mine.name)}
              sundays={rivalrySundays(CAREER, c.home.team_id, c.away.team_id)} />;
          }}
        />}
      </main>
    </>
  );
}
