/**
 * Where a team goes when you click it.
 *
 * Every team drawn anywhere in this app is a door to that team's desk, and the
 * desk is the roster: `/team?id=<team>` is somebody else's lineup, bench, form
 * and coach's read, drawn read-only by the same components as your own. The
 * rule has one wrinkle worth keeping in a single place rather than restating at
 * every door — your own team is plain `/team`, never `/team?id=<you>`. Both
 * load the same desk, but only the plain address is the editable one, and only
 * the plain one is what the nav bar highlights.
 *
 * A team with no id gets no door. Several payloads name a team without carrying
 * its id — the ledger and the trade desk quote names as strings — and those
 * surfaces draw plain text rather than a link that goes nowhere.
 */
export function teamHref(teamId: string | null | undefined, mine = false): string | null {
  if (mine) return "/team";
  return teamId ? `/team?id=${encodeURIComponent(teamId)}` : null;
}

/**
 * What a door to a team's desk says it does.
 *
 * The visible text of one of these links is usually just the team's name, and
 * on a scoreboard card it is a crest and a score as well — so the accessible
 * name says what clicking actually gets you, which is the thing a manager
 * cannot guess from a name sitting in a table.
 */
export function teamLinkLabel(name: string, mine = false): string {
  return mine ? "Open your roster" : `Open ${name}'s roster`;
}
