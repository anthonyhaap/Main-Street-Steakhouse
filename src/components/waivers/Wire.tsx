"use client";

import { ArrowDown, ArrowUp, Clock, Gavel, Trash2 } from "lucide-react";
import type { WaiverBoard, WaiverPlayer } from "@/lib/types";

/** "Wed 8:00 AM" rather than a countdown: a ticking clock on a weekly deadline
 *  is anxiety, not information. */
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

/**
 * The wire, as a manager reads it: when it settles, what he has asked for and
 * in what order, who is available, and where he sits in the queue.
 *
 * Presentation only, so the fixture at /preview/waivers can hold it still. The
 * page above it owns the fetching and the RPCs; everything here is props.
 */
export function Wire({
  board, teamName, busy, claimed, onClaim, onCancelClaim, onMove,
}: {
  board: WaiverBoard;
  teamName: string;
  busy: string | null;
  claimed: Set<string>;
  onClaim: (p: WaiverPlayer) => void;
  onCancelClaim: (claimId: string, playerName: string) => void;
  onMove: (index: number, by: -1 | 1) => void;
}) {
  return (
    <>
      <div className="card">
        <div className="card__head">
          <h2>The wire</h2>
          {board.my_priority != null && (
            <span className="eyebrow">your call: <span className="num">#{board.my_priority}</span></span>
          )}
        </div>
        <div className="card__body" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Clock size={15} style={{ color: "var(--faint)" }} />
          <span className="eyebrow">
            {board.settles_at
              ? <>Next settlement <strong>{when(board.settles_at)}</strong>. Claims are blind until then.</>
              : "No settlement scheduled."}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Your claims</h2>
          <span className="eyebrow"><span className="num">{board.my_claims.length}</span> in</span>
        </div>
        <div className="rows">
          {board.my_claims.length === 0 && (
            <div className="empty">Nothing claimed. Anyone on the wire below is fair game.</div>
          )}
          {board.my_claims.map((c, i) => (
            <div className="row" key={c.claim_id} data-hover="true">
              <span className="num" style={{ width: 22, color: "var(--faint)", textAlign: "right" }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.add}</div>
                <div className="eyebrow">{c.drop ? `releasing ${c.drop}` : "only if I have room"}</div>
              </div>
              <button className="btn" data-v="ghost" data-size="icon" aria-label={`Move ${c.add} up`}
                disabled={i === 0 || busy !== null} onClick={() => onMove(i, -1)}><ArrowUp size={14} /></button>
              <button className="btn" data-v="ghost" data-size="icon" aria-label={`Move ${c.add} down`}
                disabled={i === board.my_claims.length - 1 || busy !== null} onClick={() => onMove(i, 1)}><ArrowDown size={14} /></button>
              <button className="btn" data-v="ghost" data-size="icon" aria-label={`Cancel claim on ${c.add}`}
                disabled={busy !== null} onClick={() => onCancelClaim(c.claim_id, c.add)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>On waivers</h2>
          <span className="eyebrow"><span className="num">{board.on_waivers.length}</span> waiting</span>
        </div>
        <div className="rows">
          {board.on_waivers.length === 0 && (
            <div className="empty">
              Nobody is on the wire. A player only lands here when somebody drops him —
              anyone never owned is a free agent, and you can sign him outright.
            </div>
          )}
          {board.on_waivers.map((p) => (
            <div className="row" key={p.player_id} data-hover="true">
              <span className="pos" data-p={p.position}>{p.position}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.player}</div>
                <div className="eyebrow">{p.nfl_team ?? "FA"} · clears {when(p.clears_at)}</div>
              </div>
              <button className="btn" data-size="sm"
                disabled={busy !== null || claimed.has(p.player_id)}
                onClick={() => onClaim(p)}
                // The label has to follow the state. A disabled button reading
                // "Claimed" that still announces itself as "Claim Jaylen Wright"
                // tells a screen reader the opposite of what the screen says.
                aria-label={claimed.has(p.player_id)
                  ? `${p.player} is already claimed`
                  : `Claim ${p.player}`}
                style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Gavel size={13} />{claimed.has(p.player_id) ? "Claimed" : "Claim"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Waiver order</h2>
          <span className="eyebrow">win a claim, go to the back</span>
        </div>
        <div className="rows">
          {board.order.map((o) => (
            <div className="row" key={o.team}>
              <span className="num" style={{ width: 22, color: "var(--faint)", textAlign: "right" }}>
                {o.priority ?? "–"}
              </span>
              <div style={{ flex: 1 }}>
                {o.team}{o.team === teamName && <span className="eyebrow" style={{ marginLeft: 8 }}>you</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {board.recent.length > 0 && (
        <div className="card">
          <div className="card__head"><h2>Recent settlements</h2></div>
          <div className="rows">
            {board.recent.map((r) => (
              <div className="row" key={r.ran_at}>
                <div style={{ flex: 1 }}>{when(r.ran_at)}</div>
                <span className="eyebrow">
                  week <span className="num">{r.week}</span> ·{" "}
                  <span className="num">{r.awarded}</span> of <span className="num">{r.seen}</span> awarded
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
