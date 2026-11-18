/**
 * The league's payouts, as the managers agreed them. Shown on the home
 * screen and the League page; edit here and both follow.
 */
export type Payout = {
  /** Short mark for the place column. */
  mark: string;
  place: string;
  /** The terms, in a few words. */
  terms: string;
  /** The terms, spelled out. */
  detail: string;
};

export const PAYOUTS: Payout[] = [
  {
    mark: "1–2",
    place: "Championship game",
    terms: "Their call",
    detail: "Split decided by the two managers in it",
  },
  {
    mark: "3",
    place: "Third place",
    terms: "Money back",
    detail: "Money back",
  },
];
