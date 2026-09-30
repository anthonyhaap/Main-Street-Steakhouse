/**
 * Steakhouse Sunday, in words and rankings.
 *
 * NFL RedZone tells you what is happening around the NFL. This file says why
 * it matters to *this* league: which table is the one to watch, who is inside
 * the twenty for whom, which game is going down to the wire, and which
 * underdog is ahead.
 *
 * It reads one payload — `ff_sunday`, which is `ff_scoreboard` with the
 * week's NFL games beside it — and, like `scoreboard.ts` underneath it, every
 * function is pure. The same payload and the same clock always produce the
 * same page, which is what lets `/preview/sunday` run a whole Sunday from a
 * fixture and lets a test hold it still.
 *
 * Everything here is derived from the *state* of the board. Nothing is an
 * event that happened: "Allen scored, and that put Ray ahead" needs the board
 * before and after, stored once and deduplicated, which is the server's job
 * and not a browser's. What this file can say honestly from a single snapshot
 * — who is in the red zone, which games are within a score, who needs what —
 * it says, and it never invents a history it cannot see.
 */

import { LEAGUE_TZ } from "@/lib/config";
import {
  cardState, projectedFinal, stillToPlay, who, winOdds, fmt1,
  type ScoreCard, type ScoreSide, type ScoreStarter, type Scoreboard as Board,
} from "@/lib/scoreboard";

/* ----------------------------------------------------------------- types -- */

/** One NFL game, as `ff_sunday` sends it in `nfl`. */
export type NflGame = {
  id: string;
  home: string | null;
  away: string | null;
  home_score: number | null;
  away_score: number | null;
  kickoff_at: string | null;
  /** ESPN's: "pre" | "in" | "post". */
  status: string | null;
  /** ESPN's own words: "Final", "8:14 - 4th", "Sun 1:00 PM ET". */
  detail: string | null;
  home_spread: number | null;
  /** Our abbreviation for the club with the ball. Null unless in progress. */
  possession: string | null;
  red_zone: boolean;
  down_distance: string | null;
  updated_at: string | null;
};

/**
 * One Fantasy RedZone event, as `ff_sunday` sends it in `events`: something
 * that happened between two looks at the week, written once by the server's
 * `ff_sunday_detect` and never again. See `20261001120000_sunday_events`.
 */
export type EventType =
  | "touchdown" | "big_play" | "scoring" | "turnover" | "lead_change"
  | "close_game" | "upset_watch" | "red_zone" | "final";

export type SundayEvent = {
  id: string;
  type: EventType;
  level: 1 | 2 | 3 | 4;
  priority: number;
  matchup_id: string | null;
  /** The manager it happened for, and the one across the table. */
  team_id: string | null;
  opponent_team_id: string | null;
  player_id: string | null;
  player_name: string | null;
  espn_id: string | null;
  nfl_game_id: string | null;
  points_added: number | null;
  old_score: number | null;
  new_score: number | null;
  opp_old_score: number | null;
  opp_new_score: number | null;
  lead_change: boolean;
  headline: string;
  description: string | null;
  /** `who` / `opp` (the two managers' names), `late`, `margin`, and per-type extras. */
  detail: {
    who?: string; opp?: string; late?: boolean; margin?: number;
    position?: string; nfl_team?: string; game_detail?: string | null;
    players?: { name: string; who: string; team_id: string; matchup_id: string }[];
    [k: string]: unknown;
  };
  created_at: string;
};

/**
 * Shape of ff_sunday(league_id, week). `events` is optional because the
 * browser can be talking to a database a migration behind — every reader
 * treats it being absent and being empty the same way.
 */
export type SundayBoard = Board & { nfl: NflGame[]; events?: SundayEvent[] };

export type Side = "home" | "away";

/** A starter with the table he is starting at, and for whom. */
export type Placed = { p: ScoreStarter; side: ScoreSide; card: ScoreCard; key: Side };

const H = 3600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
export const lastName = (full: string) => full.trim().split(/\s+/).slice(-1)[0];
export const sideOf = (c: ScoreCard, k: Side) => (k === "home" ? c.home : c.away);
export const other = (k: Side): Side => (k === "home" ? "away" : "home");

/* ----------------------------------------------------------------- phase -- */

/**
 * The page's personality: before the football, during it, after it.
 *
 *   pre    nothing is on and nothing kicked in the last few hours — Sunday
 *          morning, and also Monday afternoon waiting on the late game
 *   live   a game is on, or the day is between windows: a four o'clock gap
 *          is still Sunday, and the game center should not turn back into a
 *          preview for twenty minutes while the late games kick
 *   final  every game of the week is final
 */
export type Phase = "pre" | "live" | "final";

export function sundayPhase(b: SundayBoard, now: number): Phase {
  const g = b.games;
  if (!g || g.total === 0) return "pre";
  if (g.in_progress > 0) return "live";
  if (g.final >= g.total) return "final";

  const started = (b.nfl ?? [])
    .filter((x) => x.status && x.status !== "pre" && x.kickoff_at)
    .map((x) => new Date(x.kickoff_at!).getTime());
  const lastStart = started.length ? Math.max(...started) : null;
  const next = g.next_kickoff ? new Date(g.next_kickoff).getTime() : null;
  if (lastStart !== null && next !== null && now - lastStart < 7 * H && next - now < 5 * H) return "live";
  return "pre";
}

/**
 * Sunday on the league's clock, not the phone's. The nav promotes the game
 * center on this day; the page itself decides its phase from the slate.
 */
export function isGameDay(now: number, tz = LEAGUE_TZ): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(now)) === "Sun";
}

/* ------------------------------------------------------------ excitement -- */

/**
 * The internal excitement score, and the weights that make it. One table so
 * the whole page agrees on what "interesting" means — the featured matchup,
 * the order of the alerts, what reaches the ticker — and so the weights can be
 * tuned in one place.
 *
 * Some inputs are not in a single snapshot of the board: a lead change needs
 * the board before it, a rivalry needs the history, a playoff implication
 * needs the table. They are weights here and optional inputs below, so the
 * day the server supplies them they count without anybody touching the math.
 */
export const EXCITEMENT = {
  touchdown: 20,
  leadChange: 35,
  within5: 25,
  within1: 40,
  fourthQuarter: 15,
  rivalry: 10,
  upset: 15,
  leagueHigh: 10,
  playoff: 15,
  /** Projected to finish inside five. Worth less than being inside five. */
  projectedClose: 10,
  /** Both managers at or above .500 — a game the table cares about. */
  standings: 8,
  /** Per starter on the field right now. A tiebreaker, not a reason. */
  inAction: 2,
};

export type Weights = typeof EXCITEMENT;

/** What the server may know about a card that the board does not say. */
export type CardContext = {
  leadChanges?: number;
  touchdowns?: number;
  rivalry?: boolean;
  playoff?: boolean;
};

export type Excitement = { score: number; reasons: string[] };

/** The fourth quarter, or overtime, in either of ESPN's spellings. */
const LATE = /\b(4th|Q4|OT)\b/i;

/** How much of a card is still to be played, both sides together. */
export const leftOn = (c: ScoreCard) =>
  c.home.starters.filter((p) => !p.final).length + c.away.starters.filter((p) => !p.final).length;

/** Late in a card: a starter in the fourth quarter, or three men or fewer left. */
export function isLate(c: ScoreCard): boolean {
  const state = cardState(c);
  if (state === "pre" || state === "settled") return false;
  const on = [...c.home.starters, ...c.away.starters].filter((p) => p.game_status === "in");
  return on.some((p) => LATE.test(p.game_detail ?? "")) || leftOn(c) <= 3;
}

/** Points margin, home minus away. */
export const margin = (c: ScoreCard) => round1(Number(c.home.points) - Number(c.away.points));

/** Pre-game projected gap at which the lower side counts as an underdog. */
export const UPSET_GAP = 8;

/**
 * Who came into the day the underdog, by the projection both lineups carried
 * before anyone kicked. `proj` is every starter's projection whether or not
 * he has played, so it is still the morning's number at four o'clock.
 */
export function underdog(c: ScoreCard): { key: Side; gap: number } | null {
  const gap = round1(Number(c.home.proj) - Number(c.away.proj));
  if (Math.abs(gap) < UPSET_GAP) return null;
  return { key: gap > 0 ? "away" : "home", gap: Math.abs(gap) };
}

/** The underdog is ahead on the scoreboard, once there is a scoreboard. */
export function upsetBrewing(c: ScoreCard): { key: Side; gap: number } | null {
  const dog = underdog(c);
  if (!dog || cardState(c) === "pre") return null;
  const m = margin(c);
  const ahead = dog.key === "home" ? m > 0 : m < 0;
  return ahead ? dog : null;
}

/** The highest score on the board this week, and whose it is. */
export function weekHigh(b: Board): { side: ScoreSide; card: ScoreCard } | null {
  let best: { side: ScoreSide; card: ScoreCard } | null = null;
  for (const c of b.matchups) {
    for (const s of [c.home, c.away]) {
      if (Number(s.points) > 0 && (!best || Number(s.points) > Number(best.side.points))) best = { side: s, card: c };
    }
  }
  return best;
}

const winning = (s: ScoreSide) => s.wins + s.losses + s.ties > 0 && s.wins >= s.losses;

export function excitement(
  c: ScoreCard, b: Board, ctx: CardContext = {}, w: Weights = EXCITEMENT,
): Excitement {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => { if (n) { score += n; reasons.push(why); } };
  const state = cardState(c);

  if (c.home.starters.length + c.away.starters.length === 0) return { score: 0, reasons };

  if (state === "pre") {
    if (Math.abs(Number(c.home.proj) - Number(c.away.proj)) <= 5) add(w.projectedClose, "projected close");
  } else {
    const gap = Math.abs(margin(c));
    if (gap <= 1) add(w.within1, "within a point");
    else if (gap <= 5) add(w.within5, "within five");
    else if (state !== "settled" && Math.abs(projectedFinal(c.home) - projectedFinal(c.away)) <= 5) {
      add(w.projectedClose, "projected close");
    }
    if (isLate(c)) add(w.fourthQuarter, "late");
    if (upsetBrewing(c)) add(w.upset, "upset");
    const high = weekHigh(b);
    if (high && high.card.id === c.id) add(w.leagueHigh, "week's high score");
    add((c.home.in_action + c.away.in_action) * w.inAction, "players on the field");
  }
  if (winning(c.home) && winning(c.away)) add(w.standings, "standings");
  add((ctx.leadChanges ?? 0) * w.leadChange, "lead changes");
  add((ctx.touchdowns ?? 0) * w.touchdown, "touchdowns");
  if (ctx.rivalry) add(w.rivalry, "rivalry");
  if (ctx.playoff) add(w.playoff, "playoff stakes");
  return { score, reasons };
}

/**
 * The one table the page features. Before kickoff it is the Game of the Week;
 * once football is on it is the Game to Watch, and it moves as the afternoon
 * does. After the last game it is the finish the league will talk about.
 * Ties go to the higher-scoring table.
 */
export function featured(
  b: Board, phase: Phase, ctx: Record<string, CardContext> = {}, w: Weights = EXCITEMENT,
): { card: ScoreCard; label: string; score: number } | null {
  if (b.matchups.length === 0) return null;
  const total = (c: ScoreCard) => Number(c.home.points) + Number(c.away.points) + Number(c.home.proj) + Number(c.away.proj);
  const ranked = b.matchups
    .map((card) => ({ card, score: excitement(card, b, ctx[card.id], w).score }))
    .sort((x, y) => y.score - x.score || total(y.card) - total(x.card));
  const top = ranked[0];
  const label = phase === "live" ? "Game to watch" : phase === "final" ? "Finish of the day" : "Game of the week";
  return { ...top, label };
}

/* ------------------------------------------------------------------ mood -- */

/**
 * The entertainment label on a manager: ROLLING, SWEATING, COOKED. Read off
 * the live win probability and the morning's projection, and nothing else —
 * it is a caption, not a claim, and it changes the moment the odds do.
 */
export type Mood = { key: string; emoji: string; label: string };

export function moodOf(c: ScoreCard, key: Side): Mood | null {
  const state = cardState(c);
  if (state === "pre") return null;
  const me = sideOf(c, key), them = sideOf(c, other(key));
  const m = round1(Number(me.points) - Number(them.points));
  if (state === "settled") {
    if (m === 0) return { key: "tied", emoji: "🤝", label: "Tied" };
    return m > 0 ? { key: "won", emoji: "🥩", label: "Won" } : { key: "lost", emoji: "", label: "Lost" };
  }
  const odds = winOdds(c);
  const p = key === "home" ? odds.home : odds.away;
  const dog = underdog(c);
  if (dog?.key === key && p >= 50) return { key: "upset", emoji: "👀", label: "Upset watch" };
  if (m <= -10 && p >= 50) return { key: "comeback", emoji: "🚨", label: "Comeback" };
  if (p >= 85) return { key: "rolling", emoji: "🔥", label: "Rolling" };
  if (p >= 65) return { key: "comfortable", emoji: "🧊", label: "Comfortable" };
  if (p >= 30) return { key: "sweating", emoji: "😬", label: "Sweating" };
  // Somebody with nobody left to play cannot need a miracle — he can only
  // watch — so a live chance for him reads as a sweat, whatever the number.
  const playing = me.starters.some((s) => !s.final);
  if (p >= 8) return playing
    ? { key: "miracle", emoji: "🙏", label: "Needs a miracle" }
    : { key: "sweating", emoji: "😬", label: "Sweating" };
  return { key: "cooked", emoji: "💀", label: "Cooked" };
}

/**
 * What a side needs, stated as the honest version of it: the points it would
 * take to reach where the other side is *projected* to finish. It is never
 * "score this and you win" — the other side still has men to play.
 */
export function needs(c: ScoreCard, key: Side): number | null {
  if (cardState(c) === "pre" || cardState(c) === "settled") return null;
  const me = sideOf(c, key), them = sideOf(c, other(key));
  const gap = round1(projectedFinal(them) - Number(me.points));
  if (gap <= 0 || projectedFinal(me) > projectedFinal(them)) return null;
  return gap;
}

/** Starters not yet final, the ones on the field first. */
export function remaining(s: ScoreSide): ScoreStarter[] {
  const on = s.starters.filter((p) => p.game_status === "in");
  return [...on, ...stillToPlay(s).filter((p) => p.game_status !== "in")];
}

/* ------------------------------------------------------------- the ball -- */

/** Every starter in the league, placed. */
export function everyStarter(b: Board): Placed[] {
  const out: Placed[] = [];
  for (const card of b.matchups) {
    for (const key of ["home", "away"] as Side[]) {
      const side = sideOf(card, key);
      for (const p of side.starters) out.push({ p, side, card, key });
    }
  }
  return out;
}

/** The NFL game a starter is playing in this week, if the slate has it. */
export function gameFor(nfl: NflGame[], club: string | null): NflGame | null {
  if (!club) return null;
  return nfl.find((g) => g.home === club || g.away === club) ?? null;
}

/**
 * Our players whose club has the ball inside the twenty right now. A defense
 * is left out on purpose — the other side driving on it is not good news —
 * and so is a kicker, who scores from the thirty as happily as from the eight.
 */
export function inTheRedZone(b: SundayBoard): (Placed & { game: NflGame })[] {
  const drives = (b.nfl ?? []).filter((g) => g.status === "in" && g.red_zone && g.possession);
  if (drives.length === 0) return [];
  return everyStarter(b).flatMap((x) => {
    if (x.p.position === "DST" || x.p.position === "K") return [];
    const game = drives.find((g) => g.possession === x.p.nfl_team);
    return game ? [{ ...x, game }] : [];
  });
}

/** The club with the ball in a starter's game, if it is his. */
export function hasBall(nfl: NflGame[], p: ScoreStarter): NflGame | null {
  if (p.game_status !== "in") return null;
  const g = gameFor(nfl, p.nfl_team);
  return g && g.status === "in" && g.possession === p.nfl_team ? g : null;
}

/** Our starters in one NFL game, highest-scoring first. */
export function leagueInGame(b: Board, g: NflGame): Placed[] {
  return everyStarter(b)
    .filter((x) => x.p.nfl_team && (x.p.nfl_team === g.home || x.p.nfl_team === g.away))
    .sort((x, y) => Number(y.p.points) - Number(x.p.points) || Number(y.p.projection ?? 0) - Number(x.p.projection ?? 0));
}

/** Live games first, then the ones to come by kickoff, then the finals. */
export function slateOrder(nfl: NflGame[]): NflGame[] {
  const rank = (g: NflGame) => (g.status === "in" ? 0 : g.status === "post" ? 2 : 1);
  return [...nfl].sort((a, b) =>
    rank(a) - rank(b) || (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""));
}

/* ---------------------------------------------------------------- alerts -- */

/**
 * The Fantasy RedZone, as far as a snapshot can take it: situations that are
 * true right now, ranked by importance.
 *
 *   1  normal         the week's high score, a final
 *   2  important      one of ours in the red zone
 *   3  league alert   a game within a score late, an upset brewing, down to
 *                     one man
 *   4  Steakhouse     a game inside a point with the clock running out
 *
 * The ids are stable — the kind and the table — so the same situation on the
 * next refetch is the same row, and the feed does not repeat itself.
 */
export type Level = 1 | 2 | 3 | 4;

export type Alert = {
  id: string;
  kind: "red_zone" | "close_game" | "down_to_wire" | "upset_watch" | "league_high" | "final";
  level: Level;
  score: number;
  tag: string;
  headline: string;
  lines: string[];
  matchupId: string | null;
  gameId: string | null;
  /** True while the thing it describes can still change. */
  live: boolean;
};

const scoreLine = (c: ScoreCard) => {
  const [a, b] = Number(c.home.points) >= Number(c.away.points) ? [c.home, c.away] : [c.away, c.home];
  return `${who(a)} ${fmt1(a.points)} — ${who(b)} ${fmt1(b.points)}`;
};

export function alerts(b: SundayBoard, w: Weights = EXCITEMENT): Alert[] {
  const out: Alert[] = [];
  const nfl = b.nfl ?? [];

  // Inside the twenty: one row per drive, naming every one of ours on it.
  const rz = inTheRedZone(b);
  const drives = new Map<string, typeof rz>();
  for (const x of rz) drives.set(x.game.id, [...(drives.get(x.game.id) ?? []), x]);
  for (const [gameId, xs] of drives) {
    const g = xs[0].game;
    out.push({
      id: `rz:${gameId}`, kind: "red_zone", level: 2, score: w.touchdown,
      tag: xs.length > 1 ? "Players in the red zone" : "In the red zone",
      headline: xs.length > 3
        ? `${xs.slice(0, 3).map((x) => x.p.full_name).join(", ")} +${xs.length - 3}`
        : xs.map((x) => x.p.full_name).join(", "),
      lines: [
        xs.map((x) => `${lastName(x.p.full_name)} — ${who(x.side)}`).join(" · "),
        `${g.possession} ball${g.down_distance ? ` · ${g.down_distance}` : ""}`,
      ],
      matchupId: xs[0].card.id, gameId, live: true,
    });
  }

  for (const c of b.matchups) {
    const state = cardState(c);
    if (state === "pre" || c.home.starters.length + c.away.starters.length === 0) continue;
    const ex = excitement(c, b, {}, w).score;
    const m = margin(c);
    const gap = Math.abs(m);
    const leftHome = c.home.starters.filter((p) => !p.final);
    const leftAway = c.away.starters.filter((p) => !p.final);

    if (state === "settled") {
      out.push({
        id: `final:${c.id}`, kind: "final", level: gap < 1 ? 4 : 1, score: ex,
        tag: gap < 1 ? "Decided by less than a point" : "Final",
        headline: scoreLine(c), lines: [], matchupId: c.id, gameId: null, live: false,
      });
      continue;
    }

    // One man left against an empty bench — or two against none — and the
    // side with him is behind. The Monday-night line.
    const trailing: Side | null = m < 0 ? "home" : m > 0 ? "away" : null;
    if (trailing) {
      const mine = trailing === "home" ? leftHome : leftAway;
      const theirs = trailing === "home" ? leftAway : leftHome;
      if (mine.length > 0 && mine.length <= 2 && theirs.length === 0) {
        const s = sideOf(c, trailing);
        const need = round1(gap + 0.1);
        const from = mine.map((p) => lastName(p.full_name)).join(" and ");
        const g = gameFor(nfl, mine[0].nfl_team);
        out.push({
          id: `wire:${c.id}`, kind: "down_to_wire", level: 3, score: ex + w.fourthQuarter,
          tag: "Down to the wire",
          headline: `${who(s)} needs ${fmt1(need)} from ${from}`,
          lines: [
            `${mine[0].nfl_team ?? ""}${mine[0].game_detail ? ` — ${mine[0].game_detail}` : g?.detail ? ` — ${g.detail}` : ""}`.trim(),
            scoreLine(c),
          ].filter(Boolean),
          matchupId: c.id, gameId: g?.id ?? null, live: true,
        });
        continue;
      }
    }

    if (gap <= 5 && isLate(c)) {
      const moment = gap < 1;
      out.push({
        id: `close:${c.id}`, kind: "close_game", level: moment ? 4 : 3, score: ex,
        tag: moment ? "Steakhouse moment" : "Close game",
        headline: scoreLine(c),
        lines: [
          `Difference ${fmt1(gap)}`,
          `Left: ${who(c.home)} ${leftHome.length} · ${who(c.away)} ${leftAway.length}`,
        ],
        matchupId: c.id, gameId: null, live: true,
      });
      continue;
    }

    const dog = upsetBrewing(c);
    if (dog) {
      const s = sideOf(c, dog.key), fav = sideOf(c, other(dog.key));
      out.push({
        id: `upset:${c.id}`, kind: "upset_watch", level: 3, score: ex,
        tag: "Upset watch",
        headline: `${who(s)} leads ${who(fav)}`,
        lines: [
          `Came in projected ${fmt1(dog.gap)} behind`,
          scoreLine(c),
        ],
        matchupId: c.id, gameId: null, live: true,
      });
    }
  }

  // The week's high means something once the day is under way — not at
  // eleven in the morning on the strength of Thursday night.
  const high = weekHigh(b);
  const underway = (b.games?.in_progress ?? 0) > 0 || (b.games?.final ?? 0) * 2 >= (b.games?.total ?? 0);
  if (high && underway) {
    out.push({
      id: `high:${high.side.team_id}`, kind: "league_high", level: 1, score: w.leagueHigh,
      tag: "Week's high",
      headline: `${who(high.side)} leads the league with ${fmt1(high.side.points)}`,
      lines: [], matchupId: high.card.id, gameId: null,
      live: cardState(high.card) !== "settled",
    });
  }

  return out.sort((x, y) => y.level - x.level || y.score - x.score);
}

/**
 * Close game mode: the tables within about five points late in the day,
 * lifted above the rest of the board for every member, not just the two
 * managers playing in them.
 */
export function closeGames(b: Board): ScoreCard[] {
  return b.matchups
    .filter((c) => {
      const s = cardState(c);
      return (s === "live" || s === "between") && Math.abs(margin(c)) <= 5 && isLate(c);
    })
    .sort((x, y) => Math.abs(margin(x)) - Math.abs(margin(y)));
}

/* ---------------------------------------------------------------- ticker -- */

export type TickerTarget =
  | { kind: "matchup"; id: string }
  | { kind: "game"; id: string }
  | { kind: "chat" };

export type TickerItem = { id: string; text: string; target: TickerTarget; hot: boolean };

/**
 * What runs along the bottom. The alerts first, in their order, then the
 * scores of the tables nobody alerted on, so the rail never goes quiet while
 * there is a board to read.
 */
export function tickerItems(b: SundayBoard, list: Alert[], phase: Phase, now = 0): TickerItem[] {
  // The last half hour's events that mattered, newest first. What happened
  // leads; what is merely true right now follows.
  const recent = eventsOf(b)
    .filter((e) => e.level >= 2 && (!now || now - new Date(e.created_at).getTime() <= 30 * 60_000))
    .slice(0, 6)
    .map((e): TickerItem => ({
      id: `ev:${e.id}`,
      text: eventTickerText(e),
      target: e.matchup_id ? { kind: "matchup", id: e.matchup_id } : e.nfl_game_id ? { kind: "game", id: e.nfl_game_id } : { kind: "chat" },
      hot: e.level >= 3,
    }));
  const items: TickerItem[] = [...recent, ...list.slice(0, 8).map((a): TickerItem => ({
    id: a.id,
    text: `${a.tag.toUpperCase()} · ${a.headline}`,
    target: a.matchupId ? { kind: "matchup", id: a.matchupId } : a.gameId ? { kind: "game", id: a.gameId } : { kind: "chat" },
    hot: a.level >= 3,
  }))];
  const named = new Set(list.map((a) => a.matchupId));
  for (const c of b.matchups) {
    if (named.has(c.id) || c.home.starters.length + c.away.starters.length === 0) continue;
    const pre = phase === "pre" && cardState(c) === "pre";
    const text = pre
      ? `${who(c.away)} ${fmt1(c.away.proj)} — ${who(c.home)} ${fmt1(c.home.proj)} projected`
      : `${who(c.away)} ${fmt1(c.away.points)} — ${who(c.home)} ${fmt1(c.home.points)}`;
    items.push({ id: `score:${c.id}`, text, target: { kind: "matchup", id: c.id }, hot: false });
  }
  return items;
}

/* --------------------------------------------------------------- events -- */

const eventsOf = (b: SundayBoard): SundayEvent[] => b.events ?? [];

/**
 * What the day's events know about each table that a snapshot does not: how
 * many times the lead changed hands and how many touchdowns were scored in
 * it. Fed to `excitement`, which already had the weights waiting for them.
 */
export function eventContext(events: SundayEvent[]): Record<string, CardContext> {
  const out: Record<string, CardContext> = {};
  for (const e of events) {
    if (!e.matchup_id) continue;
    const c = (out[e.matchup_id] ??= { leadChanges: 0, touchdowns: 0 });
    if (e.type === "lead_change" || e.lead_change) c.leadChanges = (c.leadChanges ?? 0) + 1;
    if (e.type === "touchdown") c.touchdowns = (c.touchdowns ?? 0) + 1;
  }
  return out;
}

/** How long a Steakhouse moment holds the featured slot. */
export const MOMENT_MS = 10 * 60_000;

/**
 * A level-4 event, recent enough to take over the featured table for a few
 * minutes: a lead change in the final minutes, a game inside a point at the
 * whistle. Newest wins; nothing older than `MOMENT_MS` counts.
 */
export function liveMoment(events: SundayEvent[], now: number): SundayEvent | null {
  for (const e of events) {
    const age = now - new Date(e.created_at).getTime();
    if (age > MOMENT_MS) break;
    if (e.level === 4 && e.matchup_id && age >= -60_000) return e;
  }
  return null;
}

/** The label on an event card, in the house's broadcast voice. */
export function eventTag(e: SundayEvent): string {
  if (e.level === 4 && e.type !== "touchdown") return "🚨 Steakhouse moment";
  switch (e.type) {
    case "touchdown": return e.level === 4 ? "🚨 Touchdown · Steakhouse moment" : "🚨 Touchdown";
    case "big_play": return "🔥 Big play";
    case "turnover": return "Turnover";
    case "lead_change": return "Lead change";
    case "close_game": return "😬 Close game";
    case "upset_watch": return "⚠️ Upset watch";
    case "red_zone": return "🔴 Red zone";
    case "final": return "Final";
    default: return "Scoring";
  }
}

/** "+6.2", "−2.0". */
export const signed = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
};

/** The ticker's line for one event: "TD JOSH ALLEN → +6.2 RAY → LEAD CHANGE". */
export function eventTickerText(e: SundayEvent): string {
  const who = e.detail.who?.toUpperCase();
  if (e.type === "touchdown" && e.player_name) {
    return [`TD ${e.player_name.toUpperCase()}`, who && `${signed(e.points_added)} ${who}`,
      e.lead_change && "LEAD CHANGE"].filter(Boolean).join(" → ");
  }
  if ((e.type === "big_play" || e.type === "turnover") && e.player_name) {
    return [e.headline.toUpperCase(), who && `${signed(e.points_added)} ${who}`,
      e.lead_change && "LEAD CHANGE"].filter(Boolean).join(" → ");
  }
  return e.description ? `${e.headline.toUpperCase()} · ${e.description}` : e.headline.toUpperCase();
}

/* ------------------------------------------------------------- pre-game -- */

/** Tables projected inside a score, closest first. */
export function closeOnPaper(b: Board, within = 8): ScoreCard[] {
  return b.matchups
    .filter((c) => c.home.starters.length + c.away.starters.length > 0)
    .map((c) => ({ c, gap: Math.abs(Number(c.home.proj) - Number(c.away.proj)) }))
    .filter((x) => x.gap <= within)
    .sort((x, y) => x.gap - y.gap)
    .map((x) => x.c);
}

/** The starters projected highest across the league, still to play. */
export function playersToWatch(b: Board, n = 6): Placed[] {
  return everyStarter(b)
    .filter((x) => !x.p.final && x.p.position !== "DST" && x.p.position !== "K")
    .sort((x, y) => Number(y.p.projection ?? 0) - Number(x.p.projection ?? 0))
    .slice(0, n);
}

/* ---------------------------------------------------------------- recap -- */

export type Recap = {
  finals: ScoreCard[];
  closest: ScoreCard | null;
  blowout: ScoreCard | null;
  highest: { side: ScoreSide; card: ScoreCard } | null;
  lowest: { side: ScoreSide; card: ScoreCard } | null;
  bestPlayer: Placed | null;
  upset: { card: ScoreCard; key: Side; gap: number } | null;
};

/**
 * Sunday at the Steakhouse: what the day came to, from the board alone. The
 * comeback, the lead changes and the most-reacted moment need the day's
 * events stored as they happened, and are not guessed at here.
 */
export function recap(b: Board): Recap {
  const cards = b.matchups.filter((c) => c.home.starters.length + c.away.starters.length > 0);
  const byGap = [...cards].sort((x, y) => Math.abs(margin(x)) - Math.abs(margin(y)));
  const sides = cards.flatMap((card) => [{ side: card.home, card }, { side: card.away, card }]);
  const bySide = [...sides].sort((x, y) => Number(y.side.points) - Number(x.side.points));
  const players = everyStarter(b).sort((x, y) => Number(y.p.points) - Number(x.p.points));

  let upset: Recap["upset"] = null;
  for (const card of cards) {
    const dog = underdog(card);
    if (!dog) continue;
    const m = margin(card);
    const won = dog.key === "home" ? m > 0 : m < 0;
    if (won && (!upset || dog.gap > upset.gap)) upset = { card, ...dog };
  }

  return {
    finals: cards,
    closest: byGap[0] ?? null,
    blowout: byGap.length > 1 ? byGap[byGap.length - 1] : null,
    highest: bySide[0] ?? null,
    lowest: bySide.length > 1 ? bySide[bySide.length - 1] : null,
    bestPlayer: players[0] && Number(players[0].p.points) > 0 ? players[0] : null,
    upset,
  };
}

/* ------------------------------------------------------------- the wire -- */

/**
 * Whether the numbers on screen have stopped moving for a reason other than
 * the football. The live poll writes every two minutes while a game is on;
 * ten minutes of silence with a game in progress is the provider, not the
 * defense. The page says so and keeps everything it has.
 */
export function delayed(b: Board, now: number, fetchFailed = false): boolean {
  if (fetchFailed) return true;
  if (!b.games || b.games.in_progress === 0) return false;
  if (!b.stats_updated_at) return true;
  return now - new Date(b.stats_updated_at).getTime() > 10 * 60_000;
}

/** "3 on the field · 4 to come · 2 done" for a side. */
export function sideCounts(s: ScoreSide) {
  const on = s.starters.filter((p) => p.game_status === "in").length;
  const done = s.starters.filter((p) => p.final).length;
  return { on, toCome: s.starters.length - on - done, done };
}

