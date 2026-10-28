import { LEAGUE_TZ } from "@/lib/config";
import { clockLabel } from "@/lib/gameday";

/**
 * The trade deadline as a moment rather than a week number.
 *
 * `ff_trade_deadline` says when trades close — four hours after the deadline
 * week's last kickoff, the instant the validator starts refusing — and how
 * much is in play. Everything here is pure, given a clock, so the desk and the
 * front page can be held still in the previews.
 */

export type TradeDeadline = {
  week: number;
  deadline_week: number;
  /** Null when the deadline week has no games on the schedule yet. */
  closes_at: string | null;
  /** The rule itself: the current week is not past the deadline week. */
  open: boolean;
  /** Offers on the table, league-wide. */
  offers: number;
  /** Trades done this season. */
  trades: number;
  /** Players on the block. */
  block: number;
  /** Offers sent to the reader's team; null when no team was asked about. */
  waiting: number | null;
};

/**
 * far     more than a week out — the desk says the week, nothing shouts.
 * week    the deadline week: a countdown on the desk, a card on the front page.
 * day     the last 24 hours: the same, louder.
 * closed  trades are over for the season.
 */
export type DeadlinePhase = "far" | "week" | "day" | "closed";

const H = 3600_000;
const D = 24 * H;

export function deadlinePhase(d: Pick<TradeDeadline, "open" | "closes_at">, now: number): DeadlinePhase {
  if (!d.open) return "closed";
  if (!d.closes_at) return "far";
  const left = Date.parse(d.closes_at) - now;
  if (left <= 0) return "closed";
  if (left < D) return "day";
  if (left <= 7 * D) return "week";
  return "far";
}

/** "3 days", "1 day", "14 hours", "40 minutes" — rounded down, never "0". */
export function timeLeft(closesAt: string, now: number): string {
  const ms = Math.max(0, Date.parse(closesAt) - now);
  if (ms >= 2 * D) return `${Math.floor(ms / D)} days`;
  if (ms >= D) return "1 day";
  if (ms >= 2 * H) return `${Math.floor(ms / H)} hours`;
  if (ms >= H) return "1 hour";
  const m = Math.max(1, Math.floor(ms / 60_000));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/**
 * When trades close, on the league's clock. Inside the last week the weekday
 * says which day it is ("Tue 12:15 AM ET"); further out it needs the date.
 */
export function closesLabel(closesAt: string, now: number): string {
  if (Date.parse(closesAt) - now <= 6 * D) return clockLabel(closesAt, true);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: LEAGUE_TZ, month: "short", day: "numeric" })
    .format(new Date(closesAt));
  return `${date}, ${clockLabel(closesAt)}`;
}

/** "2 offers waiting on you · 4 on the table · 3 on the block" — the parts that are not zero. */
export function inPlay(d: TradeDeadline): string[] {
  const out: string[] = [];
  if (d.waiting) out.push(`${d.waiting} offer${d.waiting === 1 ? "" : "s"} waiting on you`);
  if (d.offers) out.push(`${d.offers} on the table`);
  if (d.block) out.push(`${d.block} on the block`);
  return out;
}
