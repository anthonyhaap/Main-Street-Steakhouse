"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Owned } from "@/components/players/DropPicker";
import { Matchup } from "@/components/nfl";
import { gameFor, type WeekGames } from "@/lib/nfl/schedule";
import type { TradeOffer } from "@/lib/types";

/**
 * Build an offer: pick a club, then who goes each way.
 *
 * Uneven offers are allowed — two for one is a trade, and so is a gift — so
 * neither side is required. What the database will not accept is a trade with
 * nobody in it at all, or one that leaves a roster over the limit.
 *
 * By midseason most rosters sit right at that limit, so a lopsided offer
 * usually needs somebody let go. The sheet counts both rosters after the swap:
 * when yours goes over, it asks who you drop, and those drops travel with the
 * offer and happen only if it is accepted. When theirs goes over, that is
 * theirs to settle — they choose who goes when they accept.
 *
 * A counter arrives here pre-filled with the offer it answers, mirrored: what
 * they wanted from you becomes what you are being asked to give.
 */
export function OfferSheet({
  myTeamId, teams, owners, counters, start = null, rosterLimit = null, games = null, week = null, busy, onCancel, onSubmit,
}: {
  myTeamId: string;
  teams: { id: string; name: string }[];
  owners: Owned[];
  counters: TradeOffer | null;
  /** An offer already begun somewhere else — "Trade" on a player's card —
   *  so the sheet opens with him ticked. Ignored for a counter. */
  start?: { toTeamId: string | null; give: string[]; get: string[] } | null;
  /** The league's roster size (its slot count), the limit ff_validate_trade
   *  enforces. Null skips the check and leaves it to the database. */
  rosterLimit?: number | null;
  /** This week's slate, beside every name on either side of the table. */
  games?: WeekGames | null;
  week?: number | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    toTeamId: string, give: string[], get: string[], message: string, countersId: string | null,
    drops: string[],
  ) => void;
}) {
  // A counter goes back to whoever made the offer, taken from the offer rather
  // than inferred from the players in it: an offer that asks for somebody and
  // gives nobody has no arriving player to read a team off, and the old guess
  // fell through to the first club in the list — closing one manager's offer
  // while sending its answer to another. The database refuses that now too.
  const begun = counters ? null : start;
  const [toTeam, setToTeam] = useState<string>(
    counters?.proposer_team_id
      ?? (begun?.toTeamId && teams.some((t) => t.id === begun.toTeamId) ? begun.toTeamId : null)
      ?? teams[0]?.id ?? "",
  );
  const [give, setGive] = useState<Set<string>>(
    () => new Set(counters?.items.filter((i) => i.leaving).map((i) => i.player_id) ?? begun?.give ?? []),
  );
  const [get, setGet] = useState<Set<string>>(
    () => new Set(counters?.items.filter((i) => !i.leaving).map((i) => i.player_id) ?? begun?.get ?? []),
  );
  const [message, setMessage] = useState("");
  const [drops, setDrops] = useState<Set<string>>(new Set());

  const mine = useMemo(() => owners.filter((o) => o.team_id === myTeamId), [owners, myTeamId]);
  const theirs = useMemo(() => owners.filter((o) => o.team_id === toTeam), [owners, toTeam]);

  // Same arithmetic as ff_validate_trade, on the same ff_owner_at rows.
  const myAfter = mine.length - give.size + get.size;
  const theirAfter = theirs.length - get.size + give.size;
  const theirName = teams.find((t) => t.id === toTeam)?.name ?? "They";
  const need = rosterLimit ? Math.max(0, myAfter - rosterLimit) : 0;
  // Anyone you are droppable from: yours, and not already in the deal. A drop
  // that has since been put into the deal stops counting rather than lingering.
  const keepers = useMemo(() => mine.filter((o) => !give.has(o.player_id)), [mine, give]);
  const dropping = useMemo(
    () => [...drops].filter((id) => keepers.some((k) => k.player_id === id)),
    [drops, keepers],
  );
  const over: string | null = !rosterLimit ? null
    : dropping.length < need
      ? `That puts you at ${myAfter}, over the ${rosterLimit}-man limit. Pick ${need - dropping.length} more to drop below, or rebalance the deal.`
      : dropping.length > need
        ? need === 0
          ? "Your roster has room for this — nobody needs dropping."
          : `This only needs ${need} dropped — untick ${dropping.length - need}.`
        : null;
  const theirsOver = !!rosterLimit && theirAfter > rosterLimit;

  const flip = (set: Set<string>, put: (s: Set<string>) => void) => (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    put(next);
  };

  const column = (
    label: string, list: Owned[], picked: Set<string>, toggle: (id: string) => void,
    aria = label, locked: (id: string) => boolean = () => false,
  ) => (
    <div style={{ display: "grid", gap: 4 }}>
      <div className="eyebrow">{label}</div>
      <div className="rows" style={{ maxHeight: "26vh", overflowY: "auto" }}>
        {list.length === 0 && <div className="empty">Nobody.</div>}
        {list.map((o) => (
          <label className="row" key={o.player_id} data-hover="true" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={picked.has(o.player_id)}
              disabled={locked(o.player_id)}
              onChange={() => toggle(o.player_id)}
              aria-label={`${aria}: ${o.player}`}
              style={{ accentColor: "var(--gold)" }} />
            <span className="pos" data-p={o.position}>{o.position}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.player}</div>
              <div className="eyebrow" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span>{o.nfl_team ?? "FA"}</span>
                <Matchup game={gameFor(games, o.nfl_team)} week={week} />
              </div>
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

          {/* Only once the deal needs it, or something is still ticked from
              before it stopped needing it — so it can be unticked. */}
          {(need > 0 || dropping.length > 0) && column(
            `Drop to make room — ${need}`, keepers, new Set(dropping),
            flip(new Set(dropping), setDrops), "Drop",
            (id) => dropping.length >= need && !dropping.includes(id),
          )}

          {theirsOver && (
            <div className="note">
              That puts {theirName} at {theirAfter}, over the {rosterLimit}-man limit. They choose who
              to drop when they accept.
            </div>
          )}

          <input className="field" placeholder="Say something (optional)" value={message}
            maxLength={500} onChange={(e) => setMessage(e.target.value)} aria-label="Message" />

          {over && <div className="note" data-kind="error" role="alert">{over}</div>}
        </div>

        <div style={{ display: "flex", gap: "var(--s3)", padding: "var(--s4)" }}>
          <button className="btn" data-v="ghost" onClick={onCancel} disabled={busy} style={{ flex: 1 }}>
            Never mind
          </button>
          <button className="btn" data-v="gold" style={{ flex: 1 }}
            disabled={busy || !toTeam || (give.size === 0 && get.size === 0) || !!over}
            onClick={() => onSubmit(toTeam, [...give], [...get], message, counters?.id ?? null, dropping)}>
            {busy ? "…" : counters ? "Send counter" : "Send offer"}
          </button>
        </div>
      </section>
    </div>
  );
}
