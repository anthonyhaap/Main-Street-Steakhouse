"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Owned } from "@/components/players/DropPicker";

/**
 * File a claim on a player who is on waivers.
 *
 * Naming who makes way is optional here, and that is not laziness — it is the
 * difference between a claim and a signing. A claim is settled on Wednesday
 * against the roster you have *then*, so a manager with room today may not have
 * it by the time his claim is answered. Naming a drop is how he says "take this
 * player anyway"; leaving it blank is how he says "only if I have room".
 *
 * The run enforces exactly that: a claim with no room and nobody named is
 * marked invalid with those words, rather than silently dropped.
 */
export function ClaimSheet({
  player, roster, settlesAt, busy, onCancel, onSubmit,
}: {
  player: { id: string; name: string };
  roster: Owned[];
  settlesAt: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (dropPlayerId: string | null) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal
      aria-label={`Claim ${player.name}`}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <section className="modal__panel">
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">Waiver claim</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>{player.name}</h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onCancel}
            disabled={busy} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>

        <p className="eyebrow" style={{ padding: "var(--s3) var(--s4) 0" }}>
          {settlesAt
            ? `Settled ${new Date(settlesAt).toLocaleString(undefined, {
                weekday: "long", hour: "numeric", minute: "2-digit",
              })}, in waiver order. Nobody sees this until then.`
            : "Settled in waiver order. Nobody sees this until then."}
        </p>

        <div className="rows" style={{ maxHeight: "42vh", overflowY: "auto" }}>
          <label className="row" data-hover="true" style={{ cursor: "pointer" }}>
            <input type="radio" name="claimdrop" checked={picked === null}
              onChange={() => setPicked(null)} style={{ accentColor: "var(--gold)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>Only if I have room</div>
              <div className="eyebrow">Nobody is released. The claim is skipped if the roster is full.</div>
            </div>
          </label>

          {roster.map((r) => (
            <label className="row" key={r.player_id} data-hover="true" style={{ cursor: "pointer" }}>
              <input type="radio" name="claimdrop" checked={picked === r.player_id}
                onChange={() => setPicked(r.player_id)} style={{ accentColor: "var(--gold)" }} />
              <span className="pos" data-p={r.position}>{r.position}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Release {r.player}
                </div>
                <div className="eyebrow">{r.nfl_team ?? "FA"}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: "var(--s3)", padding: "var(--s4)" }}>
          <button className="btn" data-v="ghost" onClick={onCancel} disabled={busy}
            style={{ flex: 1 }}>Never mind</button>
          <button className="btn" data-v="gold" style={{ flex: 1 }} disabled={busy}
            onClick={() => onSubmit(picked)}>
            {busy ? "…" : "Put in the claim"}
          </button>
        </div>
      </section>
    </div>
  );
}
