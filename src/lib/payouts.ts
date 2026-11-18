/**
 * The league's payouts, as the managers agreed them. Shown on the home
 * screen.
 */
export type Payout = {
  place: string;
  /** The terms, in a few words. */
  terms: string;
  /** The terms, spelled out. */
  detail: string;
};

export const PAYOUTS: Payout[] = [
  {
    place: "Championship game",
    terms: "Their call",
    detail: "Split decided by the two managers in it",
  },
  {
    place: "Third place",
    terms: "Money back",
    detail: "Money back",
  },
];
