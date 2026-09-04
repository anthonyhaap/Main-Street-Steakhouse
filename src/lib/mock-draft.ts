import type { BoardPick, PoolPlayer } from "@/lib/types";
import { rosterNeeds } from "@/lib/draft";

/**
 * Pick an opponent's next player. Mock drafts deliberately use only data that
 * managers can already see in the draft room: market rank and roster shape.
 */
export function mockOpponentPick(
  pool: PoolPlayer[],
  draftedIds: Set<string>,
  rosterSlots: string[],
  teamPicks: BoardPick[],
): PoolPlayer | undefined {
  const available = pool.filter((player) => !draftedIds.has(player.id));
  const openSlots = rosterNeeds(rosterSlots, teamPicks);
  const nonBench = openSlots.filter((slot) => slot !== "BN");
  const picksLeft = Math.max(0, rosterSlots.length - teamPicks.length);
  const mustFill = nonBench.length >= picksLeft;

  const eligible = mustFill
    ? available.filter((player) => nonBench.some((slot) =>
        slot === player.position || (slot === "FLEX" && ["RB", "WR", "TE"].includes(player.position)),
      ))
    : available;

  return [...(eligible.length ? eligible : available)].sort((a, b) =>
    (a.overall_rank ?? a.adp ?? 9999) - (b.overall_rank ?? b.adp ?? 9999),
  )[0];
}
