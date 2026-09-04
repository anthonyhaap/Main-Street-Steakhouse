"use client";

import { AlertTriangle, Pause, Play, RotateCcw, Volume2, VolumeX, Zap } from "lucide-react";
import type { Draft, Team } from "@/lib/types";
import { fmtClock, pickLabel } from "@/lib/draft";
import { crestUrl } from "@/lib/crest";
import { Seal } from "@/components/ui";

type Props = {
  draft: Draft;
  onClock: Team | undefined;
  nextUp: Team | undefined;
  myTeamId: string | null;
  teamCount: number;
  msLeft: number | null;
  /** Picks until this manager is up, or null if they are out of picks. */
  picksUntilMine?: number | null;
  isCommissioner: boolean;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onUndo: () => void;
  soundMuted: boolean;
  onToggleSound: () => void;
};

export function Clock(p: Props) {
  const { draft, onClock, nextUp, myTeamId, teamCount, msLeft, picksUntilMine } = p;
  const mine = !!onClock && onClock.id === myTeamId;
  const total = teamCount * draft.rounds;
  const done = draft.status === "complete" || draft.current_pick > total;
  const myTurnLive = mine && !done && draft.status === "active";

  const urgent = msLeft !== null && msLeft <= 15000 && msLeft > 0;
  const expired = msLeft !== null && msLeft <= 0;
  const pct = msLeft !== null && draft.pick_seconds
    ? Math.max(0, Math.min(1, msLeft / (draft.pick_seconds * 1000)))
    : 0;

  return (
    <section className="card" data-accent={mine && !done ? "gold" : undefined} data-onclock={myTurnLive}
      style={{ position: "relative" }}>
      {/* the clock as a bar, so peripheral vision catches it */}
      {draft.status === "active" && msLeft !== null && (
        <div style={{ position: "absolute", inset: "0 0 auto 0", height: 2, background: "var(--rule-soft)" }}>
          <div style={{
            height: "100%", width: `${pct * 100}%`,
            background: expired ? "var(--qb)" : urgent ? "var(--gold-lit)" : "var(--gold-dim)",
            transition: "width 0.9s linear, background 0.3s var(--ease)",
          }} />
        </div>
      )}

      <div style={{
        display: "grid", gap: "clamp(var(--s3),2vw,var(--s5))", alignItems: "center",
        gridTemplateColumns: "1fr auto", padding: "var(--s5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
          {onClock && !done && <Seal name={onClock.name} src={crestUrl(onClock.logo_path)} mine={mine} size={40} />}
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" data-tone={mine && !done ? "gold" : undefined}>
              {done ? "Draft" : mine ? "You're on the clock" : "On the clock"}
            </div>
            <div className="display" style={{
              fontSize: "clamp(1.25rem,3.6vw,1.9rem)", marginTop: 4,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {done ? "Complete" : (onClock?.name ?? "—")}
            </div>
            {!done && (
              <div style={{ color: "var(--dim)", fontSize: "var(--t-micro)", marginTop: 4, letterSpacing: "0.06em" }}>
                <span className="num">{pickLabel(draft.current_pick, teamCount)}</span>
                {" · "}pick <span className="num">{draft.current_pick}</span> of <span className="num">{total}</span>
                {nextUp && <> · next up <span style={{ color: "var(--muted)" }}>{nextUp.name}</span></>}
                {!mine && picksUntilMine != null && picksUntilMine > 0 && (
                  <> · <span style={{ color: "var(--gold)", fontWeight: 600 }}>
                    {picksUntilMine === 1 ? "you're up next" : `your pick in ${picksUntilMine}`}
                  </span></>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <button className="btn" data-v="ghost" data-size="icon" onClick={p.onToggleSound}
            title={p.soundMuted ? "Unmute draft sounds" : "Mute draft sounds"}
            aria-label={p.soundMuted ? "Unmute draft sounds" : "Mute draft sounds"}
            style={{ marginBottom: 4 }}>
            {p.soundMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          {draft.status === "setup" && <div className="eyebrow">Not started</div>}
          {draft.status === "paused" && <div className="eyebrow" data-tone="gold">Paused</div>}
          {draft.status === "active" && msLeft !== null && (
            <div className="score" style={{
              fontSize: "clamp(2.2rem,8vw,3.6rem)",
              color: expired ? "var(--qb)" : urgent ? "var(--gold-lit)" : "var(--cream)",
              transition: "color 0.3s var(--ease)",
            }}>
              {fmtClock(msLeft)}
            </div>
          )}
          {expired && (
            <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", alignItems: "center", color: "var(--qb)", fontSize: "var(--t-micro)", marginTop: 3 }}>
              <AlertTriangle size={11} /> autopicking
            </div>
          )}
        </div>
      </div>

      {p.isCommissioner && (
        <div style={{
          display: "flex", gap: "var(--s2)", flexWrap: "wrap",
          padding: "0 var(--s5) var(--s4)", borderTop: "1px solid var(--rule-soft)",
          paddingTop: "var(--s3)", marginTop: 0,
        }}>
          {draft.status === "setup" && (
            <button className="btn" data-v="primary" data-size="sm" disabled={p.busy} onClick={p.onStart}>
              <Zap size={13} /> Start draft
            </button>
          )}
          {draft.status === "active" && (
            <button className="btn" data-size="sm" disabled={p.busy} onClick={p.onPause}><Pause size={13} /> Pause</button>
          )}
          {draft.status === "paused" && (
            <button className="btn" data-v="primary" data-size="sm" disabled={p.busy} onClick={p.onResume}><Play size={13} /> Resume</button>
          )}
          {draft.current_pick > 1 && draft.status !== "setup" && (
            <button className="btn" data-v="danger" data-size="sm" disabled={p.busy} onClick={p.onUndo}>
              <RotateCcw size={13} /> Undo last pick
            </button>
          )}
        </div>
      )}
    </section>
  );
}
