"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Owned } from "@/components/players/DropPicker";
import { Matchup } from "@/components/nfl";
import { gameFor, type WeekGames } from "@/lib/nfl/schedule";
import type { TradeOffer } from "@/lib/types";

/**
 * How many the reader must let go to take this offer: their roster after the
 * swap, over the limit. Zero when it fits, or when the limit is unknown — then
 * the database decides, as it does anyway.
 */
export function dropsNeeded(offer: TradeOffer, rosterSize: number, limit: number | null): number {
  if (!limit) return 0;
  const leaving = offer.items.filter((i) => i.leaving).length;
  const arriving = offer.items.length - leaving;
  return Math.max(0, rosterSize - leaving + arriving - limit);
}

/**
 * "Who makes room?" — accepting an offer that would overfill your roster.
 *
 * The other side cannot choose who is cut from yours, so an offer like that
 * arrives without your drops, and this is where they are named. The drops and
 * the acceptance go up as ONE call: nobody is released for a deal that then
 * fails to land.
 */
export function AcceptSheet({
  offer, roster, need, games = null, week = null, busy, onCancel, onAccept,
}: {
  offer: TradeOffer;
  /** The reader's players who are not already leaving in this trade. */
  roster: Owned[];
  need: number;
  games?: WeekGames | null;
  week?: number | null;
  busy: boolean;
  onCancel: () => void;
  onAccept: (drops: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const full = picked.size >= need;

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else if (!full) next.add(id);
    setPicked(next);
  };

  return (
    <div className="modal" role="dialog" aria-modal aria-label="Choose who to drop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <section className="modal__panel">
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">Roster full</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>
              Make room for {offer.from_team}&apos;s offer
            </h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onCancel}
            disabled={busy} aria-label="Cancel"><X size={14} /></button>
        </div>

        <p className="eyebrow" style={{ padding: "var(--s3) var(--s4) 0" }}>
          This trade puts you over the limit. Choose {need === 1 ? "the player" : `the ${need} players`} you
          let go. They are dropped only if the trade goes through, and go on waivers like any drop.
        </p>

        <div className="rows" style={{ maxHeight: "48vh", overflowY: "auto" }}>
          {roster.length === 0 && <div className="empty">Nobody to drop.</div>}
          {roster.map((r) => (
            <label className="row" key={r.player_id} data-hover="true" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(r.player_id)}
                disabled={busy || (full && !picked.has(r.player_id))}
                onChange={() => toggle(r.player_id)}
                aria-label={`Drop ${r.player}`}
                style={{ accentColor: "var(--gold)" }} />
              <span className="pos" data-p={r.position}>{r.position}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.player}</div>
                <div className="eyebrow" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{r.nfl_team ?? "FA"}</span>
                  <Matchup game={gameFor(games, r.nfl_team)} week={week} />
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: "var(--s3)", padding: "var(--s4)" }}>
          <button className="btn" data-v="ghost" onClick={onCancel} disabled={busy} style={{ flex: 1 }}>
            Never mind
          </button>
          <button className="btn" data-v="gold" style={{ flex: 1 }}
            disabled={busy || picked.size !== need}
            onClick={() => onAccept([...picked])}>
            {busy ? "…" : picked.size === need ? "Drop and accept" : `Pick ${need - picked.size} more`}
          </button>
        </div>
      </section>
    </div>
  );
}
