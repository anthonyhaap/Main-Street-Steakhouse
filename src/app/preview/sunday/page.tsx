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
import { gcBoard, gcChat, gcIntel, gcRecapExtras, GC_NOW, GC_STAGES, type GcStage } from "@/lib/fixtures/gamecenter";
import { WEIGHT_DIALS, talkContext, toggleReaction } from "@/lib/sunday";

export default function SundayPreviewPage() {
  const [stage, setStage] = useState<GcStage>("late");
  const [stale, setStale] = useState(false);
  const note = GC_STAGES.find((s) => s.key === stage)!.note;

  // The board and the room, held here so a reaction or a Talk-shit line can be
  // tried without a session. Nothing leaves the page.
  const [board, setBoard] = useState(() => gcBoard(stage));
  const [chat, setChat] = useState(() => gcChat(stage));
  const go = (next: GcStage) => {
    setStage(next);
    setBoard(gcBoard(next));
    setChat(gcChat(next));
  };
  const send = async (body: string, eventId?: string) => {
    const e = eventId ? board.events?.find((x) => x.id === eventId) : null;
    const text = e ? `${talkContext(e)}\n${body}` : body;
    setChat((c) => [{
      ...c[c.length - 1], id: `local-${Date.now()}`, at: new Date(GC_NOW[stage]).toISOString(),
      author: "Ray", mine: true, body: text, reactions: [],
    }, ...c]);
    if (eventId) {
      setBoard((b) => ({ ...b, events: (b.events ?? []).map((x) => (x.id === eventId ? { ...x, talk: (x.talk ?? 0) + 1 } : x)) }));
    }
  };

  // The commissioner's dials, kept on the page. Same bounds and words as
  // ff_set_sunday_weights, so the panel's refusal can be tried here too.
  const tune = async (changes: Record<string, number | null>) => {
    const defaults = gcIntel().weights;
    const next = { ...(board.intel?.weights ?? defaults) };
    for (const [k, v] of Object.entries(changes)) {
      const dial = WEIGHT_DIALS.find((d) => d.key === k);
      if (!dial) throw new Error(`no such weight: ${k}`);
      if (v === null) { next[k] = defaults[k]; continue; }
      if (!Number.isInteger(v) || v < dial.lo || v > dial.hi) {
        throw new Error(`${k} must be a whole number from ${dial.lo} to ${dial.hi}`);
      }
      next[k] = v;
    }
    setBoard((b) => (b.intel ? { ...b, intel: { ...b.intel, weights: next } } : b));
  };

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
              <button key={s.key} className="segmented__opt" data-on={s.key === stage} onClick={() => go(s.key)}>
                {s.label}
              </button>
            ))}
            <button className="segmented__opt" data-on={stale} onClick={() => setStale((v) => !v)}>
              Provider down
            </button>
          </div>
        </div>
      </div>
      <GameCenter key={stage} board={board} now={GC_NOW[stage]} delayed={stale} chat={chat}
        onSend={send} onReact={(id, emoji) => setBoard((b) => toggleReaction(b, id, emoji))} unreadChat={3}
        onTune={tune} recapExtras={stage === "final" ? gcRecapExtras() : null} />
    </>
  );
}
