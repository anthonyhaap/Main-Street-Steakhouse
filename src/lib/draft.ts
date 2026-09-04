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

/* ------------------------------------------------------------ pick grades -- */

export type PickGrade = {
  label: string;
  tone: "ok" | "warn" | "danger" | "neutral";
  /** Pick number minus market rank. Positive means he fell past where the
      market expected and the pick spent on him was later than his ADP, i.e.
      a steal; negative means the room paid an earlier pick than his ADP, a
      reach. (ADP 60 taken at pick 30: delta -30, a reach. ADP 10 taken at
      pick 40: delta +30, a steal.) */
  delta: number;
};

/**
 * How a pick stacks up against the market, using ADP (or overall rank, when
 * a player is too fresh for a market consensus) as the "expected" pick.
 *
 * This is deliberately the same read a manager gets scanning ESPN's or
 * Sleeper's live grades: how many picks early or late relative to what
 * everyone else thinks he's worth. It says nothing about whether he'll
 * actually pan out.
 */
export function gradePick(pickNumber: number, marketRank: number | null | undefined): PickGrade | null {
  if (marketRank == null) return null;
  const delta = pickNumber - marketRank;
  if (delta >= 24) return { label: "Steal", tone: "ok", delta };
  if (delta >= 9) return { label: "Value", tone: "ok", delta };
  if (delta <= -24) return { label: "Big reach", tone: "danger", delta };
  if (delta <= -9) return { label: "Reach", tone: "warn", delta };
  return { label: "On plan", tone: "neutral", delta };
}

/** ADP where the market has an opinion, else the ranker's best guess. */
export function marketRankOf(p: { adp: number | null; overall_rank: number | null } | undefined): number | null {
  if (!p) return null;
  return p.adp ?? p.overall_rank ?? null;
}
