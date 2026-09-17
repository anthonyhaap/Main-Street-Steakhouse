"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, CircleDollarSign, Copy, ExternalLink, HandCoins, ShieldCheck, X } from "lucide-react";
import { isHandheld, openVenmo, settlementNote, stakeText, venmoLinks } from "@/lib/settlement";
import type { Challenge, LeagueProfile } from "@/lib/types";

/**
 * One bet, as a card.
 *
 * Pure: everything it knows arrives as props, which is what lets
 * /preview/challenges lay every state of a bet side by side without a session
 * and lets the e2e read the Venmo amount off an href. The live page around it
 * (src/app/challenges) supplies the RPC calls.
 *
 * The card's job is to make the next step the only thing on it. A proposed bet
 * shows accept and decline to the one manager who can answer; a decided bet
 * shows the loser a Venmo link with the amount already in it and the winner a
 * request for the same; a paid bet asks the winner one question. Everybody
 * else sees the terms and the result.
 */

export type ChallengeActions = {
  onRespond: (id: string, response: "accepted" | "declined") => void;
  onMarkPaid: (id: string) => void;
  onConfirm: (id: string) => void;
  onDispute: (id: string) => void;
  onResolve: (id: string, winnerId: string) => void;
};

export const STATUS_LABEL: Record<Challenge["status"], string> = {
  proposed: "Proposed",
  accepted: "Locked",
  declined: "Declined",
  expired: "Expired",
  locked: "Locked",
  awaiting_result: "Waiting on the week",
  resolved: "Decided",
  payment_pending: "Paid, unconfirmed",
  disputed: "Under review",
  settled: "Settled",
  voided: "Void",
};

const STATUS_TONE: Partial<Record<Challenge["status"], string>> = {
  accepted: "wine", locked: "wine",
  resolved: "warn", payment_pending: "warn",
  disputed: "danger",
  settled: "ok",
  declined: "neutral", expired: "neutral", voided: "neutral",
};

/**
 * The card a push points at. `/challenges#<id>` is what every notification
 * carries; the hash names the card, and the card announces itself for a
 * moment so the eye lands on the right one of twelve.
 */
export function useTargetChallenge(ready: boolean): string | null {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    // After paint, not during the effect: the ring is a reply to the cards
    // being on screen, and the list has only just been handed its data.
    const on = window.setTimeout(() => {
      setTarget(id);
      document.getElementById(`challenge-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
    const off = window.setTimeout(() => setTarget(null), 4000);
    return () => { window.clearTimeout(on); window.clearTimeout(off); };
  }, [ready]);
  return target;
}

export function ChallengeCard({
  item, userId, busy, isCommissioner, profiles, nameOf, weekOf, target = false, actions,
}: {
  item: Challenge;
  userId: string | null;
  busy: boolean;
  isCommissioner: boolean;
  profiles: LeagueProfile[];
  /** A manager's first name, as the push wrote it. */
  nameOf: (id: string | null) => string;
  /** The NFL week a matchup bet is about, or null for a custom one. */
  weekOf: (matchupId: string | null) => number | null;
  target?: boolean;
  actions: ChallengeActions;
}) {
  const mine = !!userId && [item.challenger_id, item.opponent_id].includes(userId);
  const loserId = item.winner_id == null ? null
    : item.winner_id === item.challenger_id ? item.opponent_id : item.challenger_id;
  const iWon = !!userId && item.winner_id === userId;
  const iLost = !!userId && loserId === userId;
  const amount = stakeText(item.stake_amount_cents);
  const week = weekOf(item.matchup_id);
  const note = settlementNote(week, item.title);
  const handleOf = (id: string | null) => profiles.find((p) => p.id === id && p.settlement_provider === "venmo")?.settlement_handle ?? null;
  const overdue = !!item.settlement_due_at && new Date(item.settlement_due_at) < new Date()
    && ["resolved", "payment_pending"].includes(item.status);
  const open = ["accepted", "resolved", "payment_pending", "disputed"].includes(item.status);

  // The slip: a payment for the loser, a request for the winner. Both need the
  // other side's handle, which a stake bet cannot be accepted without.
  const pay = iLost && item.status === "resolved" && item.stake_amount_cents && handleOf(item.winner_id)
    ? venmoLinks("pay", handleOf(item.winner_id)!, item.stake_amount_cents, note) : null;
  const request = iWon && item.status === "resolved" && item.stake_amount_cents && handleOf(loserId)
    ? venmoLinks("charge", handleOf(loserId)!, item.stake_amount_cents, note) : null;

  const copySummary = () => void navigator.clipboard?.writeText(
    `${amount ?? item.stake_label} — ${item.title} — ${nameOf(loserId)} pays ${nameOf(item.winner_id)}`);

  return (
    <article
      id={`challenge-${item.id}`}
      className="card bet"
      data-accent={open ? "gold" : undefined}
      data-target={target || undefined}
    >
      <div className="card__head">
        <span className="badge" data-tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</span>
        {overdue
          ? <span className="badge" data-tone="danger">Overdue</span>
          : amount
            ? <span className="badge" data-tone="ok"><CircleDollarSign /> {amount}</span>
            : <span className="badge" data-tone="neutral">Bragging rights</span>}
      </div>

      <div className="card__body bet__body">
        <div className="eyebrow">
          {nameOf(item.challenger_id)} vs {nameOf(item.opponent_id)}{week ? ` · Week ${week}` : ""}
        </div>
        <h2 className="bet__title">{item.title}</h2>
        <p className="bet__terms">{item.terms}</p>

        <dl className="bet__facts">
          <div><dt className="eyebrow">Stakes</dt><dd>{amount ?? item.stake_label}</dd></div>
          {item.winner_id && (
            <div>
              <dt className="eyebrow">Result</dt>
              <dd><ShieldCheck size={14} color="var(--win)" /> {nameOf(item.winner_id)} won</dd>
            </div>
          )}
          {item.status === "resolved" && amount && item.settlement_due_at && (
            <div>
              <dt className="eyebrow">Due</dt>
              <dd className="num">{new Date(item.settlement_due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</dd>
            </div>
          )}
        </dl>

        {/* ------------------------------------------------ the next step -- */}
        {item.status === "proposed" && item.opponent_id === userId && (
          <div className="bet__actions">
            <button className="btn" data-v="primary" disabled={busy} onClick={() => actions.onRespond(item.id, "accepted")}>
              <Check size={14} />Accept & lock
            </button>
            <button className="btn" disabled={busy} onClick={() => actions.onRespond(item.id, "declined")}>
              <X size={14} />Decline
            </button>
          </div>
        )}
        {item.status === "proposed" && item.challenger_id === userId && (
          <p className="bet__wait">Waiting on {nameOf(item.opponent_id)}.</p>
        )}

        {pay && (
          <div className="bet__actions">
            <a
              className="btn" data-v="primary" href={pay.web} target="_blank" rel="noopener noreferrer"
              onClick={(e) => { if (isHandheld()) { e.preventDefault(); openVenmo(pay); } }}
            >
              <HandCoins size={14} />Pay {amount} in Venmo
            </a>
            <button className="btn" disabled={busy} onClick={() => actions.onMarkPaid(item.id)}>
              <Check size={14} />I paid
            </button>
          </div>
        )}
        {iLost && item.status === "resolved" && !pay && amount && (
          <div className="bet__actions">
            <button className="btn" onClick={copySummary}><Copy size={14} />Copy the slip</button>
            <button className="btn" data-v="primary" disabled={busy} onClick={() => actions.onMarkPaid(item.id)}>
              <Check size={14} />I paid
            </button>
          </div>
        )}

        {request && (
          <div className="bet__actions">
            <a
              className="btn" data-v="primary" href={request.web} target="_blank" rel="noopener noreferrer"
              onClick={(e) => { if (isHandheld()) { e.preventDefault(); openVenmo(request); } }}
            >
              <ExternalLink size={14} />Request {amount} in Venmo
            </a>
            <span className="bet__wait">Waiting on {nameOf(loserId)}.</span>
          </div>
        )}

        {item.status === "payment_pending" && iWon && (
          <div className="bet__actions">
            <button className="btn" data-v="primary" disabled={busy} onClick={() => actions.onConfirm(item.id)}>
              <ShieldCheck size={14} />Confirm received
            </button>
          </div>
        )}
        {item.status === "payment_pending" && iLost && (
          <p className="bet__wait">Marked paid. Waiting on {nameOf(item.winner_id)} to confirm.</p>
        )}
        {item.payment_reference && (mine || isCommissioner) && (
          <p className="bet__ref">Reference: {item.payment_reference}</p>
        )}

        {isCommissioner && ["accepted", "disputed"].includes(item.status) && (
          <div className="bet__ruling">
            <div className="eyebrow" data-tone="gold">Commissioner&apos;s ruling</div>
            <div className="bet__actions">
              <button className="btn" disabled={busy} onClick={() => actions.onResolve(item.id, item.challenger_id)}>
                Award {nameOf(item.challenger_id)}
              </button>
              <button className="btn" disabled={busy} onClick={() => actions.onResolve(item.id, item.opponent_id)}>
                Award {nameOf(item.opponent_id)}
              </button>
            </div>
          </div>
        )}

        {mine && ["resolved", "payment_pending"].includes(item.status) && (
          <button className="btn" data-v="ghost" data-size="sm" onClick={() => actions.onDispute(item.id)}>
            <AlertTriangle size={14} />Request review
          </button>
        )}
        {item.dispute_reason && (
          <div className="note" data-kind="error">Review requested: {item.dispute_reason}</div>
        )}
      </div>
    </article>
  );
}
