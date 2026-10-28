/**
 * Venmo, one tap from the card.
 *
 * Venmo has no API for one person to pay another on their behalf, and the
 * README says why the house would not hold the stakes even if it had one. What
 * Venmo does have is a link that opens the app on a payment already written
 * out — who, how much, and what for — so settling a bet is a tap and a
 * thumbprint rather than a username typed from memory into the wrong field.
 *
 * Two links come back for every slip. The app scheme opens Venmo directly on a
 * phone that has it; the web address is what a laptop, or a phone without the
 * app, falls through to. `openVenmo` tries the first and, if the page is still
 * on screen a moment later, goes to the second in the same tab — a new tab
 * from inside a timer is what popup blockers exist to stop.
 *
 * Pure but for `openVenmo`, so /preview/challenges can render every slip and
 * the e2e can read the amount straight off the href.
 */

export type SettlementTxn = "pay" | "charge";

/** "20.00" — Venmo wants a decimal with no dollar sign. */
export const venmoAmount = (cents: number) => (cents / 100).toFixed(2);

/** "$20", or "$12.50" when the cents matter. What the card prints. */
export function stakeText(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** The note on the payment: enough to find it again in a Venmo feed. */
export function settlementNote(week: number | null, title: string): string {
  return `Steakhouse · ${week ? `Week ${week} · ` : ""}${title}`.slice(0, 120);
}

export type VenmoLinks = { app: string; web: string };

/**
 * A payment (`pay`) to a handle, or a request (`charge`) from one. The handle
 * is stored without its @, which is how both forms of the link want it.
 */
export function venmoLinks(txn: SettlementTxn, handle: string, cents: number, note: string): VenmoLinks {
  const amount = venmoAmount(cents);
  const app = new URLSearchParams({ txn, recipients: handle, amount, note });
  const web = new URLSearchParams({ txn, amount, note });
  return {
    app: `venmo://paycharge?${app}`,
    web: `https://venmo.com/${encodeURIComponent(handle)}?${web}`,
  };
}

/** A phone, as far as a deep link cares: something that might have the app. */
export const isHandheld = () =>
  typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/**
 * Open the app if it is there, the web if it is not. Leaving the page (the app
 * opening) fires visibilitychange, which cancels the fallback; staying on it
 * means nothing answered the scheme, so the same tab goes to venmo.com.
 */
export function openVenmo(links: VenmoLinks) {
  const fallback = window.setTimeout(() => {
    if (!document.hidden) window.location.href = links.web;
  }, 900);
  const cancel = () => {
    if (document.hidden) {
      window.clearTimeout(fallback);
      document.removeEventListener("visibilitychange", cancel);
    }
  };
  document.addEventListener("visibilitychange", cancel);
  window.location.href = links.app;
}
