"use client";

import { useState } from "react";
import { AlertTriangle, Pause, Play, RefreshCw, RotateCcw, SlidersHorizontal, Volume2, VolumeX, Zap } from "lucide-react";
import type { Draft, Team } from "@/lib/types";
import { fmtClock, pickLabel, roundForPick } from "@/lib/draft";
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
  /** This manager's next overall pick numbers, soonest first. */
  myUpcoming?: number[];
  isCommissioner: boolean;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onUndo: () => void;
  onReset: () => void;
  soundMuted: boolean;
  onToggleSound: () => void;
};

/**
 * The banner: who's up, how long they have, and where the night stands.
 *
 * It used to say all of that on one nowrap line under the team name, which on
 * a phone meant "1.04 · pick 4 of 180 · next up Mea…" and nothing else. The
 * same facts are chips now: they wrap onto a second row instead of being cut
 * off, and the two that decide what you do next — how many picks until you're
 * up, and which picks you actually own — get the gold.
 */
export function Clock(p: Props) {
  const { draft, onClock, nextUp, myTeamId, teamCount, msLeft, picksUntilMine, myUpcoming } = p;
  const [tools, setTools] = useState(false);
  const mine = !!onClock && onClock.id === myTeamId;
  const total = teamCount * draft.rounds;
  const done = draft.status === "complete" || draft.current_pick > total;
  const myTurnLive = mine && !done && draft.status === "active";

  const urgent = msLeft !== null && msLeft <= 15000 && msLeft > 0;
  const expired = msLeft !== null && msLeft <= 0;
  const state = expired ? "expired" : urgent ? "urgent" : "normal";
  const pct = msLeft !== null && draft.pick_seconds
    ? Math.max(0, Math.min(1, msLeft / (draft.pick_seconds * 1000)))
    : 0;

  const made = Math.max(0, Math.min(total, draft.current_pick - 1));
  const round = Math.min(draft.rounds, roundForPick(draft.current_pick, teamCount));
  // Your own picks after this one, so "my pick in 7" has somewhere to land:
  // the numbers themselves, which is what you count the board down to.
  const laterPicks = (myUpcoming ?? []).filter((n) => n > draft.current_pick).slice(0, 3);

  return (
    <section className="card clock" data-accent={mine && !done ? "gold" : undefined} data-onclock={myTurnLive}>
      {draft.status === "active" && msLeft !== null && (
        <div className="clock__bar" data-state={state} aria-hidden>
          <i style={{ width: `${pct * 100}%` }} />
        </div>
      )}

      <div className="clock__grid">
        <div className="clock__who">
          {onClock && !done && <Seal name={onClock.name} src={crestUrl(onClock.logo_path)} mine={mine} size={40} />}
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" data-tone={mine && !done ? "gold" : undefined}>
              {done ? "Draft" : mine ? "You're on the clock" : "On the clock"}
            </div>
            <div className="display clock__name">
              {done ? "Complete" : (onClock?.name ?? "—")}
            </div>

            {!done && (
              <div className="clock__meta">
                <span className="clock__chip" title={`Round ${round} of ${draft.rounds} · ${made} picks made`}>
                  <b className="num">{pickLabel(draft.current_pick, teamCount)}</b>
                  <span className="num">{draft.current_pick}/{total}</span>
                </span>
                {nextUp && !mine && (
                  <span className="clock__chip" title={`${nextUp.name} picks next`}>
                    next <b>{nextUp.name}</b>
                  </span>
                )}
                {!mine && picksUntilMine != null && picksUntilMine > 0 && (
                  <span className="clock__chip" data-tone="gold">
                    {picksUntilMine === 1
                      ? "you're up next"
                      : <>you in <b className="num">{picksUntilMine}</b></>}
                  </span>
                )}
                {laterPicks.length > 0 && (
                  <span className="clock__chip" data-tone="wine" title="Your remaining picks">
                    yours <b className="num">{laterPicks.join(" · ")}</b>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="clock__right">
          <div style={{ display: "flex", gap: 2 }}>
            {p.isCommissioner && (
              <button className="btn" data-v="ghost" data-size="icon" onClick={() => setTools((t) => !t)}
                aria-expanded={tools} title={tools ? "Hide commissioner controls" : "Commissioner controls"}
                aria-label={tools ? "Hide commissioner controls" : "Commissioner controls"}
                style={tools ? { color: "var(--gold)" } : undefined}>
                <SlidersHorizontal size={14} />
              </button>
            )}
            <button className="btn" data-v="ghost" data-size="icon" onClick={p.onToggleSound}
              title={p.soundMuted ? "Unmute draft sounds" : "Mute draft sounds"}
              aria-label={p.soundMuted ? "Unmute draft sounds" : "Mute draft sounds"}>
              {p.soundMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
          {draft.status === "setup" && <div className="eyebrow">Not started</div>}
          {draft.status === "paused" && <div className="eyebrow" data-tone="gold">Paused</div>}
          {draft.status === "active" && msLeft !== null && (
            <div className="score clock__time" data-state={state}>{fmtClock(msLeft)}</div>
          )}
          {expired && (
            <div style={{ display: "flex", gap: 5, alignItems: "center", color: "var(--lose)", fontSize: "var(--t-micro)" }}>
              <AlertTriangle size={11} /> autopicking
            </div>
          )}
        </div>
      </div>

      {/* How much night is left, as a rule along the foot of the card. Fifteen
          rounds is a long sit; "41 of 180" is a number, this is a feeling —
          and it costs no height, which on a phone is the whole argument. */}
      {!done && draft.status !== "setup" && (
        <div className="clock__foot" aria-hidden>
          <i style={{ width: `${(made / total) * 100}%` }} />
        </div>
      )}

      {/* The commissioner's controls are three buttons she needs twice a night
          and everyone else never — so they fold away rather than standing
          between the clock and the board on a phone. */}
      {p.isCommissioner && tools && (
        <div className="clock__ctl">
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
          {draft.status !== "setup" && (
            <button className="btn" data-v="danger" data-size="sm" disabled={p.busy} onClick={p.onReset}
              title="Deletes every pick and starts the draft over from setup">
              <RefreshCw size={13} /> Reset draft
            </button>
          )}
        </div>
      )}
    </section>
  );
}
