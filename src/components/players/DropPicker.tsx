"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { PoolPlayer } from "@/lib/types";

export type Owned = {
  player_id: string;
  player: string;
  position: string;
  nfl_team: string | null;
  team_id: string;
  team: string;
};

/**
 * "Your roster is full — who goes?"
 *
 * Shown only after the database has refused a bare add, never in anticipation
 * of one. The count that decides is derived server-side and can change under
 * you; a browser that greyed the button out in advance would be guessing, and
 * would be wrong exactly when two managers want the same man.
 *
 * The chosen drop and the signing go up as ONE call, so a manager cannot end
 * up having released somebody for a player he then fails to get.
 */
export function DropPicker({
  signing, roster, busy, onCancel, onDrop,
}: {
  signing: PoolPlayer;
  roster: Owned[];
  busy: boolean;
  onCancel: () => void;
  onDrop: (playerId: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal
      aria-label={`Sign ${signing.full_name} — choose who to release`}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <section className="modal__panel">
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">Roster full</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>
              Room for {signing.full_name}?
            </h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onCancel}
            disabled={busy} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>

        <p className="eyebrow" style={{ padding: "var(--s3) var(--s4) 0" }}>
          Your roster is full. Choose the man who makes way — he goes back into the
          pool the moment this lands, and anyone can sign him.
        </p>

        <div className="rows" style={{ maxHeight: "48vh", overflowY: "auto" }}>
          {roster.length === 0 && <div className="empty">Nothing to release.</div>}
          {roster.map((r) => (
            <label className="row" key={r.player_id} data-hover="true" style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name="drop"
                checked={picked === r.player_id}
                onChange={() => setPicked(r.player_id)}
                style={{ accentColor: "var(--gold)" }}
              />
              <span className="pos" data-p={r.position}>{r.position}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.player}</div>
                <div className="eyebrow">{r.nfl_team ?? "FA"}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: "var(--s3)", padding: "var(--s4)" }}>
          <button className="btn" data-v="ghost" onClick={onCancel} disabled={busy}
            style={{ flex: 1 }}>Never mind</button>
          <button
            className="btn"
            data-v="gold"
            style={{ flex: 1 }}
            disabled={!picked || busy}
            onClick={() => picked && onDrop(picked)}
          >
            {busy ? "…" : "Make the move"}
          </button>
        </div>
      </section>
    </div>
  );
}
