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

/* --------------------------------------------------------- the money */

/**
 * What it costs to be in, and how the pots are paid. Dollars throughout.
 *
 * The league: $100 a team. Third place gets the buy-in back; whatever is left
 * splits 70 / 30 between the champion and the runner-up. (A working split —
 * the line above still says the two finalists get to settle it themselves.)
 *
 * Pick'em: $20 a head, winner takes the whole pot. Not everybody is in it, so
 * the managers who sat it out are listed by account here rather than guessed
 * from the standings.
 */
export const LEAGUE_BUY_IN = 100;
export const FIRST_SHARE = 0.7;
export const SECOND_SHARE = 0.3;

export const PICKEM_BUY_IN = 20;
/** Managers who are not in the pick'em pot (jptobin, thaappy). */
export const PICKEM_SITTING_OUT = new Set([
  "0bfa3616-d209-4d7b-8894-706ac059dc3b",
  "40fbe18d-06b3-4311-8683-a3a72e1d5e5e",
]);

/** What each league finish pays, net of the buy-in. Index 0 is first place. */
export function leagueNet(place: number, teams: number): number {
  const pot = LEAGUE_BUY_IN * teams;
  const split = pot - LEAGUE_BUY_IN; // third's money back comes off the top
  if (place === 1) return Math.round(split * FIRST_SHARE) - LEAGUE_BUY_IN;
  if (place === 2) return Math.round(split * SECOND_SHARE) - LEAGUE_BUY_IN;
  if (place === 3) return 0;
  return -LEAGUE_BUY_IN;
}

/**
 * What the pick'em pays this manager, net, if the season ended with the
 * standings as they are: the leader takes the pot, shared evenly on a tie.
 */
export function pickemNet(myRank: number, entrants: number, tiedAtTop: number): number {
  const pot = PICKEM_BUY_IN * entrants;
  if (myRank === 1 && tiedAtTop > 0) return Math.round(pot / tiedAtTop) - PICKEM_BUY_IN;
  return -PICKEM_BUY_IN;
}

/** "+$670", "−$100", "$0". */
export function signedDollars(n: number): string {
  if (n === 0) return "$0";
  return `${n > 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US")}`;
}
