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
 * A team's id from the name it is written under, for the boards that quote a
 * team by name and nothing else.
 *
 * The ledger is the reason this exists. `ff_transactions` records each side of a
 * move as a name — it is a historical account, and it reads as a sentence — so
 * there is no id to link by, and the league's own team list is the only place to
 * recover one. Prefer an id the payload already carries over this: the trade
 * desk looks like the same problem and is not, because every offer comes with
 * `proposer_team_id` and `receiver_team_id`.
 *
 * Two names that normalise the same resolve to NOTHING rather than to whichever
 * came first. A wrong door is worse than no door: it would open a roster that
 * had nothing to do with the move being read, and nothing on the screen would
 * admit it. An unresolved name is drawn as the plain text it always was.
 *
 * A renamed team is the other miss, and the same answer. Last season's entries
 * keep last season's name, that name is no longer in the league's list, and
 * those rows simply are not doors — which is honest, because the roster behind
 * the door is today's, not the one that made the trade.
 */
export function teamIdsByName(
  teams: readonly { id: string; name: string }[],
): (name: string | null | undefined) => string | null {
  const key = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
  const byName = new Map<string, string | null>();
  for (const t of teams) {
    const k = key(t.name);
    // Second sighting of a name poisons it: `has` rather than `get`, so a
    // duplicate is caught even when the first one resolved to a real id.
    byName.set(k, byName.has(k) ? null : t.id);
  }
  return (name) => (name ? byName.get(key(name)) ?? null : null);
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
