/**
 * The lineup coach.
 *
 * Everything on the team desk tells a manager one true thing about one player.
 * The projection says what he should score; the wire says his hamstring is
 * sore; the schedule says his club is on bye; the forecast says it will be
 * blowing twenty-five in Buffalo. Reading all of that across fifteen players
 * and nine slots on a Sunday morning is the actual work, and it is the work
 * people get wrong — not because the judgement is hard, but because there is
 * too much of it and kickoff is in an hour.
 *
 * So this file does it. Two steps, kept apart on purpose:
 *
 *   1. Price every player. One number per man: what we expect him to score
 *      this week, with every signal we hold folded in. Every adjustment is
 *      kept as a `Factor` — a label, a sentence and a multiplier — because a
 *      lineup change nobody can explain is a lineup change nobody will make.
 *
 *   2. Fill the slots. Highest total, subject to who may play where and who
 *      has already kicked off.
 *
 * It is a pure function of a hub, a wire, a forecast and a curve. No fetching,
 * no state, no rendering — which leaves the judgement calls as the only thing
 * in the file, the same way `insights.ts` does.
 *
 * ── what it will not do ─────────────────────────────────────────────────────
 *
 * It is a coach, not an oracle. Every multiplier is bounded, the whole stack is
 * bounded, and a player who is playing can never be priced at zero by anything
 * short of the schedule or a doctor. That is deliberate: a model that can talk
 * itself into benching your best receiver over a rain chance is worse than no
 * model, because it will be believed once and never again.
 */

import type { HubPlayer, WireInjury } from "@/lib/nfl/types";
import type { Insight } from "@/lib/nfl/insights";
import type { GameWeather } from "@/lib/nfl/venues";
import { hostOf, weatherRead } from "@/lib/nfl/weather";
import { matchupJudgement, type MatchupCurve } from "@/lib/nfl/matchup";

/* ------------------------------------------------------------------ slots -- */

const FLEX_OK = new Set(["RB", "WR", "TE"]);

/** The same rule `ff_slot_ok` enforces in the database. */
export const slotOk = (slot: string, pos: string) =>
  slot === "BN" ? true : slot === "FLEX" ? FLEX_OK.has(pos) : slot === pos;

/* ------------------------------------------------------------------ types -- */

export type Factor = {
  /** Chip text: "Questionable", "22 mph wind", "Good draw". */
  label: string;
  /** The sentence under it, in the manager's language. */
  detail: string;
  /** Multiplier on the baseline. 1 means it is worth saying and worth nothing. */
  mult: number;
};

export type Valuation = {
  player: HubPlayer;
  /** What we started from, before anything was applied. */
  base: number;
  baseFrom: "projection" | "form" | "none";
  factors: Factor[];
  /** The number the lineup is chosen on. */
  value: number;
  /** Why he cannot score at all this week, if he cannot. */
  blocked: string | null;
  /** His game has kicked off; he cannot be moved either way. */
  locked: boolean;
};

export type PlannedSlot = {
  key: string;
  slot: string;
  /** Who is in it now. */
  now: HubPlayer | null;
  /** Who should be. */
  best: Valuation | null;
  /** Fixed, because the man in it has already played. */
  locked: boolean;
};

export type Move = {
  player: HubPlayer;
  from: string;
  to: string;
  /** What he is worth in the slot he is moving into. */
  value: number;
};

export type LineupPlan = {
  slots: PlannedSlot[];
  /** Everyone the plan leaves out, best first. */
  bench: Valuation[];
  moves: Move[];
  values: Map<string, Valuation>;
  /** Expected points of the lineup as it stands. */
  now: number;
  /** Expected points of the lineup we propose. */
  best: number;
  gain: number;
  /** Which signals actually had something to say. */
  inputs: { projections: boolean; injuries: boolean; matchups: boolean; weather: boolean };
  /** Locked players the plan had to work around. */
  locked: HubPlayer[];
};

export type PlanInput = {
  roster: HubPlayer[];
  /** `league.roster_slots`, benches included. */
  slots: string[];
  week: number;
  /** The injury report, indexed by player — `injuriesByPlayer(wire)`. */
  injuries: Map<string, WireInjury>;
  /** Whether a wire was loaded at all. An empty report is not the same as none. */
  hasWire: boolean;
  weather: Map<string, GameWeather> | null;
  matchups: MatchupCurve | null;
  /** The opportunity engine's output, so a freed-up role counts here too. */
  insights: Insight[];
};

/* ------------------------------------------------------------- valuation -- */

/** Roster statuses that mean he will not be on the field, whatever the wire says. */
const GONE: Record<string, string> = {
  RES: "On injured reserve",
  CUT: "Not on an NFL roster",
  NWT: "Not with a team",
  RSN: "Retired",
};

/** Statuses that are survivable but worth a discount. */
const THIN: Record<string, string> = {
  INA: "Listed inactive",
  DEV: "On the practice squad",
  PRA: "On the practice squad",
};

/**
 * What a game listing means for availability. `out` is the only one that scores
 * a certain zero; doubtful is close enough to it that starting him is a mistake
 * you make once.
 */
const SEVERITY: Partial<Record<WireInjury["severity"], number>> = {
  doubtful: 0.2,
  questionable: 0.85,
  probable: 0.97,
};

function valuePlayer(p: HubPlayer, input: PlanInput): Valuation {
  const injury = input.injuries.get(p.player_id) ?? null;
  const forecast = input.weather?.get(hostOf(p) ?? "") ?? null;
  const factors: Factor[] = [];

  // --- the baseline ------------------------------------------------------
  // A projection when we have one; his own form when we do not. The form
  // blend leans recent, because the argument managers actually have — "what
  // has he done lately" — is the one with the shorter memory.
  const form = p.form;
  let base = 0;
  let baseFrom: Valuation["baseFrom"] = "none";

  if (p.projection != null && p.projection > 0) {
    base = p.projection;
    baseFrom = "projection";
  } else if (form && form.games > 0) {
    base = 0.55 * (form.last3_avg ?? form.avg_points) + 0.45 * form.avg_points;
    baseFrom = "form";
  }

  // --- can he score at all? ----------------------------------------------
  const blocked =
    p.on_bye ? `${p.nfl_team ?? "His club"} is on bye in week ${input.week}`
    : !p.game ? `No week ${input.week} game on the schedule`
    : injury?.severity === "out" ? `Ruled ${injury.status.toLowerCase()}${injury.detail ? ` — ${injury.detail}` : ""}`
    : GONE[p.status ?? ""] ?? null;

  if (blocked) {
    return { player: p, base, baseFrom, factors: [], value: 0, blocked, locked: p.locked };
  }

  // --- the injury report -------------------------------------------------
  if (injury && SEVERITY[injury.severity] != null) {
    factors.push({
      label: injury.status,
      detail: [
        injury.detail ? `${injury.detail}.` : null,
        injury.severity === "doubtful"
          ? "Doubtful players mostly do not play, and the ones who do are limited."
          : injury.severity === "questionable"
            ? "Questionable is a real risk of a snap count you cannot see coming."
            : "Expected to play.",
        injury.comment ?? null,
      ].filter(Boolean).join(" "),
      mult: SEVERITY[injury.severity]!,
    });
  }

  const thin = THIN[p.status ?? ""];
  if (thin) {
    factors.push({
      label: thin,
      detail: "He is on the roster but not in the first eleven of his own club's plans.",
      mult: 0.6,
    });
  }

  // --- the matchup, out of his own projection curve -----------------------
  const matchup = matchupJudgement(input.matchups?.get(p.player_id));
  if (matchup) factors.push(matchup);

  // --- the weather over the field he is playing on -----------------------
  const sky = weatherRead(p.position, forecast);
  if (sky) factors.push(sky);

  // --- the room around him, from the opportunity engine ------------------
  // `insights.ts` has already done this reading; a note about him is worth a
  // nudge, not a rewrite, because the projection may well have priced it.
  for (const note of input.insights) {
    if (note.player.player_id !== p.player_id) continue;
    if (note.kind === "boost") {
      factors.push({ label: "More work coming", detail: note.headline, mult: 1.05 });
    } else if (note.kind === "downgrade") {
      factors.push({ label: "Downgrade", detail: note.headline, mult: 0.93 });
    }
  }

  // --- form against the forecast -----------------------------------------
  // Only when a projection is the baseline: this is the one place we are
  // allowed to disagree with it, and only a little.
  if (baseFrom === "projection" && form && form.games >= 3 && form.last3_avg != null) {
    const edge = (form.last3_avg - form.avg_points) / Math.max(form.avg_points, 4);
    const mult = 1 + clamp(edge * 0.25, -0.1, 0.1);
    if (Math.abs(mult - 1) >= 0.02) {
      factors.push({
        label: mult > 1 ? "Trending up" : "Trending down",
        detail:
          `Last three at ${form.last3_avg.toFixed(1)} against ${form.avg_points.toFixed(1)} ` +
          `for the season.`,
        mult,
      });
    }
  }

  const value = factors.reduce((n, f) => n * f.mult, base);
  return { player: p, base, baseFrom, factors, value: round(value), blocked: null, locked: p.locked };
}

/* ------------------------------------------------------------ assignment -- */

/**
 * Fill the slots for the most points.
 *
 * The eligibility rules of a fantasy roster nest — FLEX accepts exactly the
 * union of RB, WR and TE, and every other slot accepts one position — so
 * filling the narrowest slot first with the best man it will take is provably
 * the best you can do, and it reads like what a manager does anyway. The pass
 * afterwards is insurance rather than decoration: it exists so that a league
 * that one day invents two overlapping flexes gets a right answer out of a
 * greedy that no longer has a proof behind it.
 *
 * Ties go to whoever is already in the slot. Two receivers a tenth of a point
 * apart should not produce a lineup change on a Sunday morning.
 */
function fill(slots: PlannedSlot[], pool: Valuation[]): Map<string, Valuation> {
  const free = slots.filter((s) => !s.locked);
  const taken = new Map<string, Valuation>();   // slot key -> player
  const used = new Set<string>();

  const score = (s: PlannedSlot, v: Valuation) =>
    v.value + (s.now?.player_id === v.player.player_id ? 1e-6 : 0);

  const eligible = (s: PlannedSlot, v: Valuation) => slotOk(s.slot, v.player.position);

  // Narrowest first, measured against the players actually available.
  const width = (s: PlannedSlot) => pool.filter((v) => eligible(s, v)).length;
  const order = [...free].sort((a, b) => width(a) - width(b));

  for (const slot of order) {
    let pick: Valuation | null = null;
    for (const v of pool) {
      if (used.has(v.player.player_id) || !eligible(slot, v)) continue;
      if (!pick || score(slot, v) > score(slot, pick)) pick = v;
    }
    if (pick) {
      taken.set(slot.key, pick);
      used.add(pick.player.player_id);
    }
  }

  // Swap anything that pays, including with a man left out. Bounded because
  // every accepted swap strictly raises the total.
  for (let pass = 0; pass < 40; pass++) {
    let better = false;

    for (const a of free) {
      const inA = taken.get(a.key) ?? null;

      for (const b of free) {
        if (a.key === b.key) continue;
        const inB = taken.get(b.key) ?? null;
        if (!inA && !inB) continue;
        if (inB && !eligible(a, inB)) continue;
        if (inA && !eligible(b, inA)) continue;

        const before = (inA ? score(a, inA) : 0) + (inB ? score(b, inB) : 0);
        const after = (inB ? score(a, inB) : 0) + (inA ? score(b, inA) : 0);
        if (after > before + 1e-9) {
          setOrClear(taken, a.key, inB);
          setOrClear(taken, b.key, inA);
          better = true;
        }
      }

      const held = taken.get(a.key) ?? null;
      for (const v of pool) {
        if (used.has(v.player.player_id) || !eligible(a, v)) continue;
        if (score(a, v) > (held ? score(a, held) : 0) + 1e-9) {
          taken.set(a.key, v);
          used.add(v.player.player_id);
          if (held) used.delete(held.player.player_id);
          better = true;
          break;
        }
      }
    }

    if (!better) break;
  }

  return taken;
}

function setOrClear(map: Map<string, Valuation>, key: string, v: Valuation | null) {
  if (v) map.set(key, v);
  else map.delete(key);
}

/* ------------------------------------------------------------------ plan -- */

export function buildLineup(input: PlanInput): LineupPlan {
  const { roster, slots } = input;

  const values = new Map<string, Valuation>();
  for (const p of roster) values.set(p.player_id, valuePlayer(p, input));

  // Who is in which slot right now — the same reading the desk draws, so the
  // plan and the lineup on screen never disagree about where a man is.
  const starting = slots.filter((s) => s !== "BN");
  const onField = roster.filter((p) => p.slot !== "BN");
  const seated = new Set<string>();

  const planned: PlannedSlot[] = starting.map((slot, i) => {
    const hit = onField.find((p) => p.slot === slot && !seated.has(p.player_id));
    if (hit) seated.add(hit.player_id);
    return {
      key: `${slot}-${i}`,
      slot,
      now: hit ?? null,
      best: null,
      // A locked man cannot leave the slot he is in, so the slot is spoken for.
      locked: hit?.locked ?? false,
    };
  });

  // Everyone still movable, best first. A locked man is not in here at all:
  // if he is starting his slot is already spoken for above, and if he is on
  // the bench that is where he is staying.
  const pool = roster
    .filter((p) => !p.locked)
    .map((p) => values.get(p.player_id)!)
    .sort((a, b) => b.value - a.value);

  const held = (p: HubPlayer | null) => (p ? values.get(p.player_id) ?? null : null);

  const taken = fill(planned, pool);
  for (const slot of planned) {
    slot.best = slot.locked ? held(slot.now) : taken.get(slot.key) ?? null;
  }

  const now = planned.reduce((n, s) => n + (held(s.now)?.value ?? 0), 0);
  const found = planned.reduce((n, s) => n + (s.best?.value ?? 0), 0);

  // A tenth of a point is not a reason to move anybody. Below it we did not
  // find anything, and say so — rather than handing back a shuffle of equal
  // men dressed up as advice. A week where nobody can score (every game gone,
  // no projections yet) lands here too, which is the right answer for it.
  const worthIt = found - now >= 0.1;
  if (!worthIt) for (const slot of planned) slot.best = held(slot.now);

  const best = worthIt ? found : now;

  const started = new Set(planned.map((s) => s.best?.player.player_id).filter(Boolean) as string[]);
  const bench = roster
    .filter((p) => !started.has(p.player_id))
    .map((p) => values.get(p.player_id)!)
    .sort((a, b) => b.value - a.value);

  // --- what actually has to change ---------------------------------------
  const destination = new Map<string, string>();
  for (const s of planned) if (s.best) destination.set(s.best.player.player_id, s.slot);

  const moves: Move[] = [];
  for (const p of roster) {
    if (p.locked) continue;
    const to = destination.get(p.player_id) ?? "BN";
    if (to !== p.slot) {
      moves.push({ player: p, from: p.slot, to, value: values.get(p.player_id)?.value ?? 0 });
    }
  }
  // The men coming in first: that is the order a manager reads a change in.
  moves.sort((a, b) => (a.to === "BN" ? 1 : 0) - (b.to === "BN" ? 1 : 0) || b.value - a.value);

  return {
    slots: planned,
    bench,
    moves,
    values,
    now: round(now),
    best: round(best),
    gain: round(best - now),
    inputs: {
      projections: roster.some((p) => p.projection != null),
      injuries: input.hasWire,
      matchups: (input.matchups?.size ?? 0) > 0,
      weather: [...(input.weather?.values() ?? [])].some((w) => w.state === "forecast"),
    },
    locked: roster.filter((p) => p.locked),
  };
}

/* ----------------------------------------------------------------- utils -- */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 100) / 100;
