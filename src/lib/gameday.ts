/**
 * Game day, from one manager's chair.
 *
 * `sunday.ts` reads the week as a broadcast: which table is the one to watch,
 * who is inside the twenty, which game is close. This file reads it the way a
 * manager opens the app between plays — *my* game first, then what just
 * happened, then what the rest of the league is doing — and turns each into
 * the words the screen prints.
 *
 * It is one layer over the same two sources and adds no third:
 *
 *   events   `sunday_events`, written once per thing that happened by the
 *            server's detector (touchdowns, lead changes, comebacks …)
 *   state    the board as it stands: who leads, who is left, who is close
 *
 * A sentence about something that *happened* is only ever written from an
 * event; a sentence about something that *is* comes from the board, and says
 * so in the present tense. Nothing here diffs two refetches in a browser —
 * twelve phones would each tell a different history.
 *
 * Every function is pure, so `/preview/sunday` can hold any seat at any hour
 * and a test can read the sentence.
 */

import { LEAGUE_TZ } from "@/lib/config";
import {
  cardState, fmt1, who, winOdds,
  type ScoreCard, type ScoreSide, type ScoreStarter, type Scoreboard as Board, type WinOdds,
} from "@/lib/scoreboard";
import {
  gameFor, lastName, margin, other, sideOf, signed, upsetBrewing, weekHigh,
  type NflGame, type Side, type SundayBoard, type SundayEvent, type TickerItem,
} from "@/lib/sunday";

const MIN = 60_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const lineups = (c: ScoreCard) => c.home.starters.length + c.away.starters.length > 0;

/* ------------------------------------------------------------------ seat -- */

/** My table, and which side of it I sit on. Null when I have no game. */
export type Seat = { card: ScoreCard; key: Side; me: ScoreSide; them: ScoreSide };

export function seatOf(b: Board): Seat | null {
  const card = b.matchups.find((c) => c.home.mine || c.away.mine);
  if (!card) return null;
  const key: Side = card.home.mine ? "home" : "away";
  return { card, key, me: sideOf(card, key), them: sideOf(card, other(key)) };
}

/** "Winning", "Losing", "Won", "Favored" — the one word under a score. */
export type Standing = { word: string; tone: "up" | "down" | "even" };

export function standingOf(c: ScoreCard, key: Side): Standing {
  const state = cardState(c);
  const me = sideOf(c, key), them = sideOf(c, other(key));
  if (state === "pre") {
    const d = round1(Number(me.proj) - Number(them.proj));
    if (Math.abs(d) < 0.05) return { word: "Even", tone: "even" };
    return d > 0 ? { word: "Favored", tone: "up" } : { word: "Underdog", tone: "down" };
  }
  const d = round1(Number(me.points) - Number(them.points));
  if (state === "settled") {
    if (d === 0) return { word: "Tied", tone: "even" };
    return d > 0 ? { word: "Won", tone: "up" } : { word: "Lost", tone: "down" };
  }
  if (d === 0) return { word: "All square", tone: "even" };
  return d > 0 ? { word: "Winning", tone: "up" } : { word: "Losing", tone: "down" };
}

/**
 * The odds, when they can say something. `winOdds` is the board's own model
 * (documented in scoreboard.ts) — not a new one — and it is withheld where it
 * would be decoration: no lineups, or no projections to separate two sides
 * that have not kicked.
 */
export function oddsFor(c: ScoreCard): WinOdds | null {
  if (!lineups(c)) return null;
  if (cardState(c) === "pre" && Number(c.home.proj) + Number(c.away.proj) === 0) return null;
  return winOdds(c);
}

/** Counts for a side: on the field now, still to come, done. */
export function leftOf(s: ScoreSide) {
  const live = s.starters.filter((p) => p.game_status === "in").length;
  const left = s.starters.filter((p) => !p.final).length;
  return { live, left };
}

/** A starter's state in a word, for a row that has room for one. */
export type PlayerState = "live" | "final" | "upcoming" | "out" | "bye" | "none";

export function playerState(p: ScoreStarter): PlayerState {
  if (p.on_bye) return "bye";
  if (p.severity === "out" && p.game_status !== "in" && p.game_status !== "post") return "out";
  if (p.game_status === "in") return "live";
  if (p.game_status === "post" || (p.final && p.kickoff_at)) return "final";
  if (p.kickoff_at || p.game_status === "pre") return "upcoming";
  return "none";
}

/* ------------------------------------------------------------- the clock -- */

const ZONES: Record<string, string> = { EDT: "ET", EST: "ET", CDT: "CT", CST: "CT", MDT: "MT", MST: "MT", PDT: "PT", PST: "PT" };

/** "1:00 PM ET", "Sun 1:00 PM ET" — in the league's zone, never the phone's. */
export function clockLabel(iso: string, withDay = false, tz = LEAGUE_TZ): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short",
    ...(withDay ? { weekday: "short" } : {}),
  }).formatToParts(new Date(iso));
  const zone = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return parts.map((p) => (p.type === "timeZoneName" ? ZONES[zone] ?? zone : p.value)).join("").replace(",", "");
}

/** Monday, Thursday… — on the league's calendar. */
export function weekdayName(now: number, tz = LEAGUE_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(now));
}

/**
 * What to say when nothing is on: the next game on the real slate, and when
 * the board starts moving. Null when the slate has nothing left.
 */
export type NextUp = { game: NflGame; at: string; label: string; ours: number };

export function nextUp(b: SundayBoard, now: number): NextUp | null {
  const next = (b.nfl ?? [])
    .filter((g) => (!g.status || g.status === "pre") && g.kickoff_at && Date.parse(g.kickoff_at) > now - 5 * MIN)
    .sort((x, y) => x.kickoff_at!.localeCompare(y.kickoff_at!))[0];
  if (!next) return null;
  const ours = b.matchups.flatMap((c) => [...c.home.starters, ...c.away.starters])
    .filter((p) => p.nfl_team && (p.nfl_team === next.home || p.nfl_team === next.away)).length;
  return { game: next, at: next.kickoff_at!, label: clockLabel(next.kickoff_at!, true), ours };
}

/* ------------------------------------------------------------- the story -- */

/**
 * One event, told fantasy-first: the tag, what happened, who it was worth
 * points to, and what it did to the game. The NFL fact is the title; the
 * league consequence is the line under it.
 *
 *   TOUCHDOWN
 *   Jahmyr Gibbs                     ← title
 *   +6.8 Mike                        ← impact
 *   Mike takes the lead over Toby, 113.4–109.8.   ← line
 */
export type Story = {
  tag: string;
  title: string;
  sub?: string;
  impact?: { text: string; neg: boolean };
  line?: string;
  /** For the `data-tone` the card wears. */
  tone: "hot" | "gold" | "plain";
};

const splitHead = (h: string) => {
  const i = h.indexOf(" — ");
  return i < 0 ? { name: h, rest: null } : { name: h.slice(0, i), rest: h.slice(i + 3) };
};

/** "Mike takes the lead over Toby, 113.4–109.8." / "Mike trails Toby 104.1–109.8." */
function scoreAfter(e: SundayEvent): string | null {
  const a = e.new_score, b = e.opp_new_score, me = e.detail.who, opp = e.detail.opp;
  if (a == null || b == null || !me || !opp) return null;
  const s = `${fmt1(a)}–${fmt1(b)}`;
  if (e.lead_change) return `${me} takes the lead over ${opp}, ${s}.`;
  const d = Number(a) - Number(b);
  if (Math.abs(d) < 0.05) return `${me} and ${opp} are level at ${fmt1(a)}.`;
  return d > 0 ? `${me} leads ${opp} ${s}.` : `${me} trails ${opp} ${s}.`;
}

export function eventStory(e: SundayEvent): Story {
  const me = e.detail.who;
  const impact = me && e.points_added != null
    ? { text: `${signed(e.points_added)} ${me}`, neg: Number(e.points_added) < 0 }
    : undefined;
  const { name, rest } = splitHead(e.headline);
  switch (e.type) {
    case "touchdown":
      return { tag: e.level >= 4 ? "Touchdown · Steakhouse moment" : "Touchdown", title: e.player_name ?? name,
        sub: rest && rest !== "touchdown" ? rest : undefined, impact, line: scoreAfter(e) ?? undefined, tone: e.lead_change ? "hot" : "gold" };
    case "big_play":
      return { tag: "Big play", title: e.player_name ?? name, sub: rest ?? undefined, impact,
        line: scoreAfter(e) ?? undefined, tone: e.lead_change ? "hot" : "gold" };
    case "turnover":
      return { tag: "Turnover", title: e.player_name ?? name, sub: rest ?? undefined, impact,
        line: scoreAfter(e) ?? undefined, tone: "plain" };
    case "scoring":
      return { tag: "Scoring", title: e.player_name ?? name, impact, line: scoreAfter(e) ?? undefined, tone: "plain" };
    case "lead_change": {
      const passes = me && e.detail.opp ? `${me} passes ${e.detail.opp}` : e.headline;
      const line = me && e.detail.opp && e.new_score != null && e.opp_new_score != null
        ? `${me.toUpperCase()} ${fmt1(e.new_score)} · ${e.detail.opp.toUpperCase()} ${fmt1(e.opp_new_score)}` : e.description ?? undefined;
      return { tag: e.level >= 4 ? "Lead change · late" : "Lead change", title: passes, line, tone: "hot" };
    }
    case "comeback":
      return { tag: "Comeback", title: e.headline, line: e.description ?? undefined, tone: "hot" };
    case "tightening":
      return { tag: "Getting interesting", title: e.headline, line: e.description ?? undefined, tone: "gold" };
    case "monster_game":
      return { tag: "Monster game", title: e.player_name ?? name, line: e.description ?? undefined, tone: "gold" };
    case "close_game":
      return { tag: "Close game", title: e.headline, line: e.description ?? undefined, tone: "hot" };
    case "upset_watch":
      return { tag: "Upset watch", title: e.headline, line: e.description ?? undefined, tone: "gold" };
    case "season_high":
      return { tag: "Season high", title: e.headline, line: e.description ?? undefined, tone: "gold" };
    case "red_zone":
      return { tag: "Red zone", title: e.headline.replace(/^In the red zone:\s*/, ""), line: e.description ?? undefined, tone: "hot" };
    case "final":
      return { tag: "Final", title: e.headline, line: e.description ?? undefined, tone: "plain" };
    default:
      return { tag: "Update", title: e.headline, line: e.description ?? undefined, tone: "plain" };
  }
}

const involves = (e: SundayEvent, teamId: string | null) =>
  !!teamId && (e.team_id === teamId || e.opponent_team_id === teamId);

/**
 * "What just happened?" — the moments of the last while, newest first. The
 * league's big ones (level 2 and up), plus anything that moved *my* score,
 * however small: a field goal is noise for eleven people and news for one.
 * Red-zone trips are left out: they are what is happening, not what happened,
 * and the red-zone box says them better.
 */
export function justHappened(events: SundayEvent[], now: number, myTeamId: string | null, n = 3, windowMin = 45): SundayEvent[] {
  return events
    .filter((e) => e.type !== "red_zone" && e.type !== "final")
    .filter((e) => e.level >= 2 || (involves(e, myTeamId) && e.type !== "upset_watch"))
    .filter((e) => !now || now - Date.parse(e.created_at) <= windowMin * MIN)
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, n);
}

/** The newest event about one table, of the kinds that change its story. */
export function latestFor(events: SundayEvent[], matchupId: string, now = 0, withinMin = Infinity): SundayEvent | null {
  return events
    .filter((e) => e.matchup_id === matchupId && e.type !== "red_zone")
    .filter((e) => !now || now - Date.parse(e.created_at) <= withinMin * MIN)
    .filter((e) => e.level >= 2 || e.type === "scoring")
    .sort((x, y) => y.created_at.localeCompare(x.created_at))[0] ?? null;
}

/* ---------------------------------------------------------------- moment -- */

/**
 * The matchup moment: the one thing worth saying about a table *right now*,
 * in a small box under its score. In order of how much it changes what a
 * manager watches next:
 *
 *   a lead that changed hands in the last quarter hour (from the event, and
 *     only while that side is still the one in front)
 *   down to the wire: one side done, the other needing it from one or two men
 *   one man each: the head-to-head that decides it
 *   getting interesting: a deficit cut close (from the event)
 *   within two, live
 *
 * Null otherwise — a box that always says something is a box nobody reads.
 */
export type Moment = { tag: string; title: string; lines: string[]; tone: "hot" | "gold" };

export function matchupMoment(c: ScoreCard, events: SundayEvent[], nfl: NflGame[], now: number): Moment | null {
  const state = cardState(c);
  if (state === "pre" || state === "settled" || !lineups(c)) return null;
  const m = margin(c);
  const gap = Math.abs(m);
  const leaderKey: Side | null = m > 0 ? "home" : m < 0 ? "away" : null;
  const recent = events.filter((e) => e.matchup_id === c.id && now - Date.parse(e.created_at) <= 15 * MIN)
    .sort((x, y) => y.created_at.localeCompare(x.created_at));

  const flip = recent.find((e) => e.type === "lead_change" || e.type === "comeback" || (e.lead_change && e.type !== "close_game"));
  if (flip && leaderKey && sideOf(c, leaderKey).team_id === flip.team_id) {
    const s = sideOf(c, leaderKey);
    const g = flip.nfl_game_id ? nfl.find((x) => x.id === flip.nfl_game_id) : flip.detail.nfl_team ? gameFor(nfl, String(flip.detail.nfl_team)) : null;
    const clock = g && g.status === "in" && g.detail ? `${g.detail} · ${g.away} @ ${g.home}` : (flip.detail.game_detail as string | null) ?? null;
    return {
      tag: flip.type === "comeback" ? "Comeback" : "Lead change",
      title: `${who(s)} takes the lead by ${fmt1(gap)}`,
      lines: [flip.player_name ? `${flip.player_name}${flip.points_added != null ? `, ${signed(flip.points_added)}` : ""}` : null, clock]
        .filter((x): x is string => !!x),
      tone: "hot",
    };
  }

  const leftH = c.home.starters.filter((p) => !p.final);
  const leftA = c.away.starters.filter((p) => !p.final);
  const where = (p: ScoreStarter) => {
    const g = gameFor(nfl, p.nfl_team);
    const when = p.game_status === "in" ? (p.game_detail ?? g?.detail ?? "Live")
      : p.kickoff_at ? clockLabel(p.kickoff_at, true) : "";
    return `${p.full_name} — ${p.nfl_team ?? "FA"}${when ? ` · ${when}` : ""}`;
  };

  if (leaderKey) {
    const trail = other(leaderKey);
    const mine = trail === "home" ? leftH : leftA;
    const theirs = trail === "home" ? leftA : leftH;
    if (mine.length > 0 && mine.length <= 2 && theirs.length === 0) {
      const s = sideOf(c, trail);
      return {
        tag: `Needs ${fmt1(gap + 0.1)}`,
        title: `${who(s)} has ${mine.length === 1 ? "one player" : "two players"} left`,
        lines: mine.map(where),
        tone: "gold",
      };
    }
  }
  if (leftH.length === 1 && leftA.length === 1) {
    return {
      tag: "Head to head",
      title: `${lastName(leftH[0].full_name)} against ${lastName(leftA[0].full_name)} decides it`,
      lines: [where(leftA[0]), where(leftH[0])],
      tone: "gold",
    };
  }

  const tight = recent.find((e) => e.type === "tightening");
  if (tight && leaderKey && gap <= 8) return { tag: "Getting interesting", title: tight.headline, lines: tight.description ? [tight.description] : [], tone: "gold" };

  if (state === "live" && gap <= 2) {
    return {
      tag: gap < 0.05 ? "Dead level" : `Within ${fmt1(gap)}`,
      title: gap < 0.05 ? "Nothing between them" : `${who(sideOf(c, leaderKey!))} is clinging on`,
      lines: [`Left: ${who(c.away)} ${leftA.length} · ${who(c.home)} ${leftH.length}`],
      tone: "hot",
    };
  }
  return null;
}

/* ----------------------------------------------------------- league pulse -- */

/**
 * League Pulse: what is happening across every table, ranked the way the
 * brief ranks it — lead changes, close games, big scoring, upsets, huge
 * days, playoff consequences, bench pain — and no more than two lines a
 * table, so one wild game cannot drown the other five.
 *
 * Every line is either an event (in the past tense, from the server) or a
 * fact the board shows right now (present tense). A quiet league gets a short
 * pulse, never a padded one.
 */
export type PulseKind =
  | "lead" | "close" | "score" | "upset" | "monster" | "high" | "playoff" | "bench" | "tight" | "moment";

export type PulseItem = {
  id: string;
  kind: PulseKind;
  emoji: string;
  text: string;
  matchupId: string | null;
  weight: number;
  /** Mine: it is about the reader's own table. */
  mine: boolean;
};

/** A starter's afternoon worth its own line, when the league has not tuned `monster_points`. */
export const MONSTER_POINTS = 30;
/** Bench pain must beat the starter it could have replaced by at least this. */
export const BENCH_PAIN = 10;
const FLEX_OK = new Set(["RB", "WR", "TE"]);

const ord = (n: number) => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** Could this reserve have filled that starter's slot? */
const eligible = (bench: ScoreStarter, slot: string) =>
  slot === bench.position || ((slot === "FLEX" || slot === "W/R/T") && FLEX_OK.has(bench.position));

/**
 * The bench decision that hurt, when one did: a reserve whose game is over,
 * who outscored a finished starter he could have replaced by `BENCH_PAIN` or
 * more. Both games done, so it is a fact rather than a sweat.
 */
export function benchPain(s: ScoreSide): { bench: ScoreStarter; starter: ScoreStarter; swing: number } | null {
  let best: { bench: ScoreStarter; starter: ScoreStarter; swing: number } | null = null;
  for (const b of s.bench ?? []) {
    if (!b.final || !b.kickoff_at) continue;
    for (const p of s.starters) {
      if (!p.final || !eligible(b, p.slot)) continue;
      const swing = round1(Number(b.points) - Number(p.points));
      if (swing >= BENCH_PAIN && (!best || swing > best.swing)) best = { bench: b, starter: p, swing };
    }
  }
  return best;
}

/**
 * The table, if every game ended as it stands — the same order the standings
 * use (wins, then ties, then points for). Only the crossings of the playoff
 * line and jumps of three places or more are worth a line.
 */
function asItStands(b: SundayBoard): { team_id: string; from: number; to: number }[] {
  const i = b.intel;
  if (!i || i.table.length === 0) return [];
  if (!i.table.some((r) => r.wins + r.losses + r.ties > 0)) return [];
  if (b.week > i.regular_season_weeks) return [];
  const rows = new Map(i.table.map((r) => [r.team_id, { ...r, pf: Number(r.pf) }]));
  let moved = false;
  for (const c of b.matchups) {
    if (cardState(c) === "pre" || !lineups(c)) continue;
    const h = rows.get(c.home.team_id), a = rows.get(c.away.team_id);
    if (!h || !a) continue;
    moved = true;
    const m = margin(c);
    if (m > 0) { h.wins++; a.losses++; } else if (m < 0) { a.wins++; h.losses++; } else { h.ties++; a.ties++; }
    h.pf += Number(c.home.points); a.pf += Number(c.away.points);
  }
  if (!moved) return [];
  const next = [...rows.values()].sort((x, y) => y.wins - x.wins || y.ties - x.ties || y.pf - x.pf);
  return next.map((r, k) => ({ team_id: r.team_id, from: r.rank, to: k + 1 }));
}

function sideById(b: Board, teamId: string): { side: ScoreSide; card: ScoreCard } | null {
  for (const card of b.matchups) {
    if (card.home.team_id === teamId) return { side: card.home, card };
    if (card.away.team_id === teamId) return { side: card.away, card };
  }
  return null;
}

export function leaguePulse(b: SundayBoard, now: number, limit = 7): PulseItem[] {
  const out: PulseItem[] = [];
  const events = b.events ?? [];
  const mineIds = new Set(b.matchups.filter((c) => c.mine).map((c) => c.id));
  const push = (x: Omit<PulseItem, "mine">) => out.push({ ...x, mine: !!x.matchupId && mineIds.has(x.matchupId) });
  const fresh = (e: SundayEvent, mins: number) => !now || now - Date.parse(e.created_at) <= mins * MIN;
  const told = new Set<string>();

  // 1. What happened in the last half hour: lead changes, comebacks, the
  //    deficits being cut, the big scoring plays, a monster day called out.
  for (const e of events) {
    if (!fresh(e, 30)) continue;
    const s = eventStory(e);
    if (e.type === "lead_change" || e.type === "comeback" || (e.lead_change && (e.type === "touchdown" || e.type === "big_play"))) {
      if (told.has(`lead:${e.matchup_id}`)) continue;
      told.add(`lead:${e.matchup_id}`);
      const by = e.player_name && e.type !== "lead_change" && e.type !== "comeback" ? ` on ${e.player_name}'s ${e.type === "touchdown" ? "touchdown" : "big play"}` : "";
      const text = e.type === "comeback"
        ? `${e.headline}${e.description ? ` — ${e.description.toLowerCase()}` : ""}`
        : `${e.detail.who ?? "Somebody"} takes the lead over ${e.detail.opp ?? "the other side"}${by}`;
      push({ id: `ev:${e.id}`, kind: "lead", emoji: "🔥", text, matchupId: e.matchup_id, weight: 100 + e.level });
    } else if (e.type === "tightening") {
      told.add(`close:${e.matchup_id}`);
      push({ id: `ev:${e.id}`, kind: "tight", emoji: "📈", text: e.headline, matchupId: e.matchup_id, weight: 82 });
    } else if (e.type === "monster_game" && e.player_name) {
      told.add(`monster:${e.player_name}`);
      push({ id: `ev:${e.id}`, kind: "monster", emoji: "💥", text: `${e.player_name}: ${e.description ?? "a monster game"}`, matchupId: e.matchup_id, weight: 68 });
    } else if (e.type === "season_high") {
      push({ id: `ev:${e.id}`, kind: "moment", emoji: "🏆", text: `${e.headline}${e.description ? ` — ${e.description}` : ""}`, matchupId: e.matchup_id, weight: 90 });
    } else if ((e.type === "touchdown" || e.type === "big_play") && e.level >= 2 && s.impact) {
      push({ id: `ev:${e.id}`, kind: "score", emoji: e.type === "touchdown" ? "🏈" : "⚡", text: `${s.title} ${e.type === "touchdown" ? "TD" : "big play"} · ${s.impact.text}`, matchupId: e.matchup_id, weight: 55 + Math.min(10, Math.abs(Number(e.points_added ?? 0))) });
    }
  }

  // 2. What is true right now, table by table. A monster day is the league's
  // own dial, the same one the server's monster_game event reads.
  const monster = Number(b.intel?.weights?.monster_points) || MONSTER_POINTS;
  const table = b.intel?.table ?? [];
  const rankOf = (id: string) => table.find((r) => r.team_id === id && r.wins + r.losses + r.ties > 0)?.rank ?? null;
  for (const c of b.matchups) {
    const state = cardState(c);
    if (!lineups(c) || state === "pre") continue;
    const m = margin(c), gap = Math.abs(m);
    const lead = m > 0 ? c.home : c.away, trail = m > 0 ? c.away : c.home;

    if (state !== "settled" && gap <= 5 && !told.has(`close:${c.id}`)) {
      push({
        id: `close:${c.id}`, kind: "close", emoji: "🚨", matchupId: c.id, weight: 88 - gap,
        text: gap < 0.05 ? `${who(c.away)} and ${who(c.home)} are dead level at ${fmt1(c.home.points)}`
          : `${who(trail)} is within ${fmt1(gap)} of ${who(lead)}`,
      });
    }

    const dog = upsetBrewing(c);
    if (dog && state !== "settled") {
      const s = sideOf(c, dog.key), fav = sideOf(c, other(dog.key));
      const rs = rankOf(s.team_id), rf = rankOf(fav.team_id);
      const text = rs && rf && rs > rf
        ? `${ord(rs)}-place ${who(s)} is leading ${ord(rf)}-place ${who(fav)}`
        : `${who(s)} leads ${who(fav)} — projected ${fmt1(dog.gap)} behind this morning`;
      push({ id: `upset:${c.id}`, kind: "upset", emoji: "👀", text, matchupId: c.id, weight: 72 });
    }

    for (const s of [c.home, c.away]) {
      for (const p of s.starters) {
        if (Number(p.points) < monster || told.has(`monster:${p.full_name}`)) continue;
        told.add(`monster:${p.full_name}`);
        push({ id: `monster:${p.player_id}`, kind: "monster", emoji: "💥", matchupId: c.id, weight: 60 + Math.min(15, Number(p.points) - monster),
          text: `${p.full_name} has ${fmt1(p.points)} for ${who(s)}${p.game_status === "in" ? " and is still going" : ""}` });
      }
      const pain = benchPain(s);
      if (pain) {
        push({ id: `bench:${s.team_id}`, kind: "bench", emoji: "💀", matchupId: c.id, weight: 40 + pain.swing,
          text: `${who(s)} left ${fmt1(pain.bench.points)} on the bench — ${lastName(pain.bench.full_name)} outscored ${lastName(pain.starter.full_name)} by ${fmt1(pain.swing)}` });
      }
    }
  }

  // The week's high, once the day is properly under way.
  const high = weekHigh(b);
  const underway = (b.games?.in_progress ?? 0) > 0 || (b.games?.final ?? 0) * 2 >= (b.games?.total ?? 1);
  if (high && underway && Number(high.side.points) >= 100) {
    const pts = Number(high.side.points);
    const mark = Math.floor(pts / 10) * 10;
    push({ id: `high:${high.side.team_id}`, kind: "high", emoji: "👑", matchupId: high.card.id, weight: 45,
      text: pts >= 130 ? `${who(high.side)} is past ${mark} — the week's high, ${fmt1(pts)}` : `${who(high.side)} has the week's high, ${fmt1(pts)}` });
  }

  // As it stands: who crosses the playoff line, or jumps three places.
  const line = b.intel?.playoff_teams ?? 0;
  // Once every table is settled it is no longer "as it stands"; it stood.
  const done = b.matchups.every((c) => !lineups(c) || cardState(c) === "settled");
  const lead = done ? "With the week done," : "As it stands,";
  for (const r of asItStands(b)) {
    const found = sideById(b, r.team_id);
    if (!found || r.from === r.to) continue;
    const name = who(found.side);
    let text: string | null = null;
    if (line && r.from > line && r.to <= line) text = `${lead} ${name} climbs into a playoff spot (${ord(r.from)} → ${ord(r.to)})`;
    else if (line && r.from <= line && r.to > line) text = `${lead} ${name} drops out of the playoff spots (${ord(r.from)} → ${ord(r.to)})`;
    else if (r.from - r.to >= 3) text = `${lead} ${name} jumps from ${ord(r.from)} to ${ord(r.to)}`;
    if (text) push({ id: `table:${r.team_id}`, kind: "playoff", emoji: "⚡", text, matchupId: found.card.id, weight: 74 });
  }

  // Two lines a table at most, best first; mine gets the tie.
  const per = new Map<string, number>();
  return out
    .sort((x, y) => y.weight - x.weight || Number(y.mine) - Number(x.mine))
    .filter((x) => {
      if (!x.matchupId) return true;
      const n = (per.get(x.matchupId) ?? 0) + 1;
      per.set(x.matchupId, n);
      return n <= 2;
    })
    .slice(0, limit);
}

/** The pulse, as ticker lines. */
export function pulseTicker(items: PulseItem[]): TickerItem[] {
  return items.map((p) => ({
    id: `pulse:${p.id}`,
    text: `${p.emoji} ${p.text.toUpperCase()}`,
    target: p.matchupId ? { kind: "matchup" as const, id: p.matchupId } : { kind: "chat" as const },
    hot: p.weight >= 80,
  }));
}

/* ------------------------------------------------------- the NFL, for us -- */

/** How many of the league's starters are in a game, and how many are on the field now. */
export function leagueCount(b: Board, g: NflGame): { total: number; live: number } {
  let total = 0, live = 0;
  for (const c of b.matchups) for (const p of [...c.home.starters, ...c.away.starters]) {
    if (!p.nfl_team || (p.nfl_team !== g.home && p.nfl_team !== g.away)) continue;
    total++;
    if (p.game_status === "in") live++;
  }
  return { total, live };
}
