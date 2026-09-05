"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Owned } from "@/components/players/DropPicker";

/**
 * Choose who you would listen to offers on.
 *
 * The whole list is the list: unticking somebody removes him, because a block
 * that only ever grows stops meaning anything by week six.
 */
export function BlockSheet({
  roster, listed, busy, onCancel, onSave,
}: {
  roster: Owned[];
  listed: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (playerIds: string[], note: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(listed));
  const [note, setNote] = useState("");

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="modal" role="dialog" aria-modal aria-label="List players on the trade block"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <section className="modal__panel">
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">Trade block</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>Who will you listen about?</h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onCancel}
            disabled={busy} aria-label="Cancel"><X size={14} /></button>
        </div>

        <div style={{ padding: "0 var(--s4)" }}>
          <input className="field" placeholder="A note for the league (optional)"
            value={note} maxLength={140} onChange={(e) => setNote(e.target.value)}
            aria-label="Note for the league" />
        </div>

        <div className="rows" style={{ maxHeight: "44vh", overflowY: "auto" }}>
          {roster.length === 0 && <div className="empty">Nothing to list.</div>}
          {roster.map((r) => (
            <label className="row" key={r.player_id} data-hover="true" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(r.player_id)}
                onChange={() => toggle(r.player_id)}
                aria-label={`List ${r.player}`}
                style={{ accentColor: "var(--gold)" }} />
              <span className="pos" data-p={r.position}>{r.position}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.player}</div>
                <div className="eyebrow">{r.nfl_team ?? "FA"}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: "var(--s3)", padding: "var(--s4)" }}>
          <button className="btn" data-v="ghost" onClick={onCancel} disabled={busy} style={{ flex: 1 }}>
            Never mind
          </button>
          <button className="btn" data-v="gold" style={{ flex: 1 }} disabled={busy}
            onClick={() => onSave([...picked], note)}>
            {busy ? "…" : "Save the block"}
          </button>
        </div>
      </section>
    </div>
  );
}
