"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Owned } from "@/components/players/DropPicker";
import type { TradeOffer } from "@/lib/types";

/**
 * Build an offer: pick a club, then who goes each way.
 *
 * Uneven offers are allowed — two for one is a trade, and so is a gift — so
 * neither side is required. What the database will not accept is a trade with
 * nobody in it at all, or one that leaves either roster over the limit, and it
 * says which when it refuses.
 *
 * A counter arrives here pre-filled with the offer it answers, mirrored: what
 * they wanted from you becomes what you are being asked to give.
 */
export function OfferSheet({
  myTeamId, teams, owners, counters, busy, onCancel, onSubmit,
}: {
  myTeamId: string;
  teams: { id: string; name: string }[];
  owners: Owned[];
  counters: TradeOffer | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    toTeamId: string, give: string[], get: string[], message: string, countersId: string | null,
  ) => void;
}) {
  // A counter goes back to whoever made the offer, taken from the offer rather
  // than inferred from the players in it: an offer that asks for somebody and
  // gives nobody has no arriving player to read a team off, and the old guess
  // fell through to the first club in the list — closing one manager's offer
  // while sending its answer to another. The database refuses that now too.
  const [toTeam, setToTeam] = useState<string>(
    counters?.proposer_team_id ?? teams[0]?.id ?? "",
  );
  const [give, setGive] = useState<Set<string>>(
    () => new Set(counters?.items.filter((i) => i.leaving).map((i) => i.player_id) ?? []),
  );
  const [get, setGet] = useState<Set<string>>(
    () => new Set(counters?.items.filter((i) => !i.leaving).map((i) => i.player_id) ?? []),
  );
  const [message, setMessage] = useState("");

  const mine = useMemo(() => owners.filter((o) => o.team_id === myTeamId), [owners, myTeamId]);
  const theirs = useMemo(() => owners.filter((o) => o.team_id === toTeam), [owners, toTeam]);

  const flip = (set: Set<string>, put: (s: Set<string>) => void) => (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    put(next);
  };

  const column = (
    label: string, list: Owned[], picked: Set<string>, toggle: (id: string) => void,
  ) => (
    <div style={{ display: "grid", gap: 4 }}>
      <div className="eyebrow">{label}</div>
      <div className="rows" style={{ maxHeight: "26vh", overflowY: "auto" }}>
        {list.length === 0 && <div className="empty">Nobody.</div>}
        {list.map((o) => (
          <label className="row" key={o.player_id} data-hover="true" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={picked.has(o.player_id)}
              onChange={() => toggle(o.player_id)}
              aria-label={`${label}: ${o.player}`}
              style={{ accentColor: "var(--gold)" }} />
            <span className="pos" data-p={o.position}>{o.position}</span>
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {o.player}
            </div>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="modal" role="dialog" aria-modal
      aria-label={counters ? "Counter the offer" : "Make a trade offer"}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <section className="modal__panel">
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">{counters ? "Counter" : "Offer"}</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>
              {counters ? `Answer ${counters.from_team}` : "Make an offer"}
            </h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onCancel}
            disabled={busy} aria-label="Cancel"><X size={14} /></button>
        </div>

        <div className="card__body" style={{ display: "grid", gap: "var(--s3)" }}>
          <label className="eyebrow" style={{ display: "grid", gap: 4 }}>
            Trading with
            <select className="field" value={toTeam} disabled={!!counters}
              onChange={(e) => { setToTeam(e.target.value); setGet(new Set()); }}
              aria-label="Trading with">
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>

          {column("You give", mine, give, flip(give, setGive))}
          {column("You get", theirs, get, flip(get, setGet))}

          <input className="field" placeholder="Say something (optional)" value={message}
            maxLength={500} onChange={(e) => setMessage(e.target.value)} aria-label="Message" />
        </div>

        <div style={{ display: "flex", gap: "var(--s3)", padding: "var(--s4)" }}>
          <button className="btn" data-v="ghost" onClick={onCancel} disabled={busy} style={{ flex: 1 }}>
            Never mind
          </button>
          <button className="btn" data-v="gold" style={{ flex: 1 }}
            disabled={busy || !toTeam || (give.size === 0 && get.size === 0)}
            onClick={() => onSubmit(toTeam, [...give], [...get], message, counters?.id ?? null)}>
            {busy ? "…" : counters ? "Send counter" : "Send offer"}
          </button>
        </div>
      </section>
    </div>
  );
}
