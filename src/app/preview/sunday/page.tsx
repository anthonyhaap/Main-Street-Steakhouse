"use client";

/**
 * Fixture harness for Steakhouse Sunday. Not linked from anywhere.
 *
 * The live page needs a session, a drafted league and an afternoon of real
 * football, so it can only be judged on a Sunday. This runs an invented one
 * (`@/lib/fixtures/gamecenter`) through the real component: Sunday morning,
 * the one o'clock window, the late window, and Tuesday's recap — plus the
 * switch that makes the provider go quiet, so the delayed state can be looked
 * at on purpose.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { GameCenter } from "@/components/sunday/GameCenter";
import { gcBoard, gcChat, GC_NOW, GC_STAGES, type GcStage } from "@/lib/fixtures/gamecenter";

export default function SundayPreviewPage() {
  const [stage, setStage] = useState<GcStage>("late");
  const [stale, setStale] = useState(false);
  const note = GC_STAGES.find((s) => s.key === stage)!.note;

  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px var(--gutter)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
        display: "grid", gap: 8,
      }}>
        <span>
          <strong>Fixture.</strong> One invented week: real players and a real-shaped NFL slate; the
          managers, scores, projections and possession are made up. {note}
        </span>
        <div className="scroll" style={{ overflowX: "auto" }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {GC_STAGES.map((s) => (
              <button key={s.key} className="segmented__opt" data-on={s.key === stage} onClick={() => setStage(s.key)}>
                {s.label}
              </button>
            ))}
            <button className="segmented__opt" data-on={stale} onClick={() => setStale((v) => !v)}>
              Provider down
            </button>
          </div>
        </div>
      </div>
      <GameCenter key={stage} board={gcBoard(stage)} now={GC_NOW[stage]} delayed={stale} chat={gcChat(stage)} />
    </>
  );
}
