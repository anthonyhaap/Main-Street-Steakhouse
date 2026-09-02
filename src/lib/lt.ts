/**
 * The plaque on the wall: Lawrence Taylor, number 56.
 *
 * Every steakhouse worth eating in has one wall it never changes. This is ours
 * — the standard the league is nominally held to, printed under the hero on the
 * home page and turning over once a day so it stays worth reading.
 *
 * Two rules about the contents, both deliberate:
 *
 *   Facts, not quotations. Everything below is a record, an award or a date
 *   that can be checked. Nothing here is presented as something a real person
 *   said, because a misremembered quote put in somebody's mouth on a wall is
 *   worse than no wall — the same reason the /preview/team fixture invents its
 *   injured players instead of guessing about real ones.
 *
 *   Text, not footage. NFL Films owns the highlights, and a league of twelve
 *   friends is not a licence. This costs nothing to serve, works on a phone in
 *   a car park, and does not get old on the thirtieth sign-in the way an
 *   autoplaying clip would.
 */

/** The four numbers, fixed. These are the ones people argue with. */
export const LT_STATS: { value: string; label: string }[] = [
  { value: "132.5", label: "Career sacks" },
  { value: "10", label: "Straight Pro Bowls" },
  { value: "3×", label: "Defensive Player of the Year" },
  { value: "1986", label: "NFL MVP" },
];

/** One a day, in no particular order. */
export const LT_NOTES: string[] = [
  "The only rookie ever named Defensive Player of the Year — 1981, his first season.",
  "1986: twenty and a half sacks, and the last time a defensive player was named NFL MVP.",
  "Ten Pro Bowls in his first ten seasons, 1981 through 1990.",
  "First-team All-Pro eight times, six of them back to back.",
  "132.5 official sacks — and the league did not start counting them until his second year.",
  "Two rings. Super Bowl XXI and Super Bowl XXV.",
  "Canton, 1999. First ballot.",
  "The Giants retired 56 in 1994. Nobody has worn it since.",
  "The 1980s All-Decade team, the NFL's 75th anniversary team, and its 100th.",
  "Michael Lewis built The Blind Side on one argument: LT is why left tackles get paid.",
];

/**
 * Today's line, the same one for everybody in the league.
 *
 * Taken from the clock rather than at random, so the plaque does not flicker
 * through the whole list while the dashboard re-renders every second, and so
 * two managers looking at it in the same room see the same thing. The five-hour
 * shift turns the day over around midnight on the east coast instead of during
 * the Sunday night game.
 */
export function ltNote(now: number): string {
  const day = Math.floor((now - 5 * 3600_000) / 86_400_000);
  return LT_NOTES[((day % LT_NOTES.length) + LT_NOTES.length) % LT_NOTES.length];
}
