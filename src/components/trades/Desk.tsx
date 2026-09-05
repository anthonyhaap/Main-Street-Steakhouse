"use client";

import { ArrowLeftRight, Check, Tag, X } from "lucide-react";
import type { TradeDesk, TradeOffer } from "@/lib/types";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * An offer, read from one side of the table.
 *
 * "Leaving" and "arriving" rather than the two team names, because a trade is
 * only ever read by one of the two people in it and the question they are
 * actually asking is what they give up and what they get. The names are in the
 * header for the case where it is somebody else's settled trade.
 */
function Offer({
  offer, busy, onRespond, onCounter,
}: {
  offer: TradeOffer;
  busy: string | null;
  onRespond: (id: string, response: "accepted" | "declined" | "cancelled") => void;
  onCounter: (offer: TradeOffer) => void;
}) {
  const leaving = offer.items.filter((i) => i.leaving);
  const arriving = offer.items.filter((i) => !i.leaving);
  const live = offer.status === "proposed";

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card__head">
        <div>
          <div className="eyebrow" data-tone={live ? "gold" : undefined}>
            {offer.mine ? `you offered ${offer.to_team}` : `${offer.from_team} offered you`}
            {offer.counters_id && " · a counter"}
          </div>
          <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0", fontSize: "1.05rem" }}>
            {live ? "On the table" : offer.outcome ?? offer.status}
          </h2>
        </div>
        <span className="eyebrow">{when(offer.created_at)}</span>
      </div>

      <div className="card__body" style={{ display: "grid", gap: "var(--s3)" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div className="eyebrow">You give</div>
          {leaving.length === 0 && <div className="eyebrow" style={{ color: "var(--faint)" }}>nobody</div>}
          {leaving.map((i) => (
            <div key={i.player_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="pos" data-p={i.position}>{i.position}</span>
              <span>{i.player}</span>
              <span className="eyebrow">{i.nfl_team ?? "FA"}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--faint)" }}>
          <ArrowLeftRight size={14} />
          <div className="hairline" style={{ flex: 1 }} />
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div className="eyebrow">You get</div>
          {arriving.length === 0 && <div className="eyebrow" style={{ color: "var(--faint)" }}>nobody</div>}
          {arriving.map((i) => (
            <div key={i.player_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="pos" data-p={i.position}>{i.position}</span>
              <span>{i.player}</span>
              <span className="eyebrow">{i.nfl_team ?? "FA"}</span>
            </div>
          ))}
        </div>

        {offer.message && <p className="eyebrow" style={{ fontStyle: "italic" }}>“{offer.message}”</p>}

        {live && (
          <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
            {offer.mine ? (
              <button className="btn" data-v="ghost" data-size="sm" disabled={busy !== null}
                onClick={() => onRespond(offer.id, "cancelled")}>
                <X size={14} /> Withdraw
              </button>
            ) : (
              <>
                <button className="btn" data-v="gold" data-size="sm" disabled={busy !== null}
                  onClick={() => onRespond(offer.id, "accepted")}>
                  <Check size={14} /> Accept
                </button>
                <button className="btn" data-size="sm" disabled={busy !== null}
                  onClick={() => onCounter(offer)}>
                  <ArrowLeftRight size={14} /> Counter
                </button>
                <button className="btn" data-v="ghost" data-size="sm" disabled={busy !== null}
                  onClick={() => onRespond(offer.id, "declined")}>
                  <X size={14} /> Decline
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The trade desk: what is on the table, and what the league is advertising.
 *
 * Presentation only, so /preview/trades can hold it still.
 */
export function Desk({
  desk, busy, onRespond, onCounter, onOpenBlock, onMakeOffer,
}: {
  desk: TradeDesk;
  busy: string | null;
  onRespond: (id: string, response: "accepted" | "declined" | "cancelled") => void;
  onCounter: (offer: TradeOffer) => void;
  onOpenBlock: () => void;
  onMakeOffer: () => void;
}) {
  const live = desk.offers.filter((o) => o.status === "proposed");
  const done = desk.offers.filter((o) => o.status !== "proposed");
  const past = desk.week > desk.deadline_week;

  return (
    <>
      <div className="card">
        <div className="card__head">
          <h2>Trades</h2>
          <span className="eyebrow">
            {past
              ? <>deadline passed in week <span className="num">{desk.deadline_week}</span></>
              : <>deadline: week <span className="num">{desk.deadline_week}</span></>}
          </span>
        </div>
        {past && (
          <div className="card__body">
            <span className="eyebrow">
              The deadline was week {desk.deadline_week}. Nothing more moves this season.
            </span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <h2>On the table</h2>
          <span className="eyebrow"><span className="num">{live.length}</span> live</span>
        </div>
        {live.length === 0 && (
          <div className="rows"><div className="empty">
            Nothing on the table. The block below is who the league says it will listen about.
          </div></div>
        )}
      </div>

      {live.map((o) => (
        <Offer key={o.id} offer={o} busy={busy} onRespond={onRespond} onCounter={onCounter} />
      ))}

      <div className="card">
        <div className="card__head">
          <h2>The block</h2>
          <button className="btn" data-v="ghost" data-size="sm" onClick={onOpenBlock}>
            <Tag size={13} /> List yours
          </button>
        </div>
        <div className="rows">
          {desk.block.length === 0 && (
            <div className="empty">Nobody is advertising. Listing a player promises nothing.</div>
          )}
          {desk.block.map((b) => (
            <div className="row" key={`${b.team_id}-${b.player_id}`} data-hover="true">
              <span className="pos" data-p={b.position}>{b.position}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.player}
                </div>
                <div className="eyebrow">
                  {b.team}{b.mine && " · yours"}{b.note && ` · “${b.note}”`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Inside the desk rather than the page, because whether it is pressable
          is a fact about the deadline, which is desk data. Split across two
          files, the button and the rule that disables it drift. */}
      <button className="btn" data-v="primary" style={{ width: "100%" }}
        disabled={past || busy !== null} onClick={onMakeOffer}>
        Make an offer
      </button>

      {done.length > 0 && (
        <div className="card">
          <div className="card__head"><h2>Settled</h2></div>
          <div className="rows">
            {done.slice(0, 12).map((o) => (
              <div className="row" key={o.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.mine ? `to ${o.to_team}` : `from ${o.from_team}`}
                  </div>
                  <div className="eyebrow">{o.outcome ?? o.status}</div>
                </div>
                <span className="eyebrow">{when(o.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
