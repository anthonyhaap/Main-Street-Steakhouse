"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { Challenge } from "@/lib/types";

/**
 * Every bet in the league, sorted by what it asks of the reader.
 *
 * The page used to be one grid newest-first, which put a settled bet from
 * week 3 between the shot somebody just called on you and the Venmo slip you
 * owe. Three groups instead: what is waiting on you, what is still in play,
 * and what is done. The cards are unchanged — the next step on each is still
 * the only button on it — but the ones with a next step for you come first.
 *
 * On a phone the settled pile is folded behind its count; it is the record,
 * not the business, and it was most of the scrolling.
 */

const DONE = new Set<Challenge["status"]>(["settled", "voided", "declined", "expired"]);

/** Whether this bet's next step is the reader's to take. Mirrors the buttons
 *  `ChallengeCard` draws for the same seat. */
export function waitingOn(item: Challenge, userId: string | null, isCommissioner: boolean): boolean {
  if (!userId) return false;
  const loser = item.winner_id == null ? null
    : item.winner_id === item.challenger_id ? item.opponent_id : item.challenger_id;
  switch (item.status) {
    case "proposed": return item.opponent_id === userId;
    // The loser owes; the winner's request is a nudge, not a step he owes.
    case "resolved": return loser === userId;
    case "payment_pending": return item.winner_id === userId;
    case "accepted":
    case "disputed": return isCommissioner;
    default: return false;
  }
}

export function ChallengeBoard({ items, userId, isCommissioner, card }: {
  items: Challenge[];
  userId: string | null;
  isCommissioner: boolean;
  card: (item: Challenge) => ReactNode;
}) {
  const [showDone, setShowDone] = useState(false);
  const yours = items.filter((c) => !DONE.has(c.status) && waitingOn(c, userId, isCommissioner));
  const live = items.filter((c) => !DONE.has(c.status) && !waitingOn(c, userId, isCommissioner));
  const done = items.filter((c) => DONE.has(c.status));

  return (
    <div className="bets">
      {yours.length > 0 && (
        <section className="bets__group" aria-label="Waiting on you">
          <h2 className="bets__label" data-tone="wine">Waiting on you <span className="num">{yours.length}</span></h2>
          <div className="grid-auto">{yours.map(card)}</div>
        </section>
      )}
      {live.length > 0 && (
        <section className="bets__group" aria-label="In play">
          <h2 className="bets__label">In play <span className="num">{live.length}</span></h2>
          <div className="grid-auto">{live.map(card)}</div>
        </section>
      )}
      {done.length > 0 && (
        <section className="bets__group" aria-label="Settled" data-open={showDone}>
          <h2 className="bets__label">
            Settled <span className="num">{done.length}</span>
            <button type="button" className="btn m-only" data-v="ghost" data-size="sm"
              aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide" : "Show"} <ChevronDown size={13} aria-hidden />
            </button>
          </h2>
          <div className="grid-auto bets__done">{done.map(card)}</div>
        </section>
      )}
    </div>
  );
}
