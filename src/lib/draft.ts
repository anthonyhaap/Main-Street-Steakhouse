import type { BoardPick, Draft, Team } from "@/lib/types";

/**
 * Mirrors public.ff_snake_slot exactly. The server is authoritative for who may
 * pick; this is only so the board can *show* the order without a round trip.
 * If these two ever disagree, the server wins and this is the bug.
 */
export function snakeSlot(pick: number, teamCount: number): number {
  const round = Math.floor((pick - 1) / teamCount) + 1;
  const idx = pick - (round - 1) * teamCount;
  return round % 2 === 0 ? teamCount - idx + 1 : idx;
}

export function roundForPick(pick: number, teamCount: number): number {
  return Math.floor((pick - 1) / teamCount) + 1;
}

export function totalPicks(draft: Draft, teamCount: number): number {
  return teamCount * draft.rounds;
}

/** Team on the clock for a given overall pick number. */
export function teamAtPick(pick: number, teams: Team[], teamCount: number): Team | undefined {
  const slot = snakeSlot(pick, teamCount);
  return teams.find((t) => t.draft_slot === slot);
}

/** Overall pick numbers a team still owns, from `fromPick` onward. */
export function upcomingPicksFor(
  teamSlot: number,
  fromPick: number,
  rounds: number,
  teamCount: number,
): number[] {
  const out: number[] = [];
  for (let p = fromPick; p <= rounds * teamCount; p++) {
    if (snakeSlot(p, teamCount) === teamSlot) out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}

export function pickLabel(pick: number, teamCount: number): string {
  const round = roundForPick(pick, teamCount);
  const inRound = pick - (round - 1) * teamCount;
  return `${round}.${String(inRound).padStart(2, "0")}`;
}

/** Roster slots a team has yet to fill, given what they've drafted. */
export function rosterNeeds(slots: string[], drafted: BoardPick[]): string[] {
  const remaining = [...slots];
  const flexOk = new Set(["RB", "WR", "TE"]);

  for (const p of drafted) {
    let i = remaining.indexOf(p.position);
    if (i === -1 && flexOk.has(p.position)) i = remaining.indexOf("FLEX");
    if (i === -1) i = remaining.indexOf("BN");
    if (i !== -1) remaining.splice(i, 1);
  }
  return remaining;
}

/**
 * The roster as it will seed: each slot, and the pick that fills it. Same
 * placement order as rosterNeeds, so the two never disagree about what is
 * still open. Picks that fit nowhere spill onto the bench.
 */
export function fillRoster(slots: string[], drafted: BoardPick[]): { slot: string; pick: BoardPick | null }[] {
  const out = slots.map((slot) => ({ slot, pick: null as BoardPick | null }));
  const flexOk = new Set(["RB", "WR", "TE"]);

  for (const p of drafted) {
    let i = out.findIndex((o) => !o.pick && o.slot === p.position);
    if (i === -1 && flexOk.has(p.position)) i = out.findIndex((o) => !o.pick && o.slot === "FLEX");
    if (i === -1) i = out.findIndex((o) => !o.pick && o.slot === "BN");
    if (i !== -1) out[i].pick = p;
    else out.push({ slot: "BN", pick: p });
  }
  return out;
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
