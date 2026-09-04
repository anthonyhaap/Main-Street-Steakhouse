/**
 * Tonight's Table — the words on the card.
 *
 * `ff_briefing` hands the browser the facts: who I am playing, both totals,
 * who still has a game to play, my record and seed, the all-time record
 * against tonight's opponent, last week's result, and the state of the NFL
 * slate. This file turns those facts into the three things a manager reads in
 * the first second: what day it is for the league, one true sentence about
 * the week, and the one thing to do now.
 *
 * Every function is pure. The same payload and the same clock always produce
 * the same card, which is what lets `/preview/tonight` show every personality
 * from one fixture and lets a test assert the sentence.
 */

import { LEAGUE_TZ } from "@/lib/config";

/* ----------------------------------------------------------------- types -- */
/** Shape of ff_briefing(league_id). */

export type StreakOf = { kind: "W" | "L" | "T" | null; n: number };

export type BriefTeam = {
  team_id: string;
  name: string;
  manager_name: string | null;
  logo_path: string | null;
  wins: number;
  losses: number;
  ties: number;
  seed: number | null;
  points_for?: number;
  points_against?: number;
};

export type BriefStarter = {
  player_id: string;
  full_name: string;
  position: string;
  nfl_team: string | null;
  slot: string;
  espn_id: string | null;
  points: number;
  projection: number | null;
  kickoff_at: string | null;
  /** ESPN's: "pre" | "in" | "post". Null when he has no game this week. */
  game_status: string | null;
  opponent: string | null;
  on_bye: boolean;
  /** His game is over, or he never had one. */
  final: boolean;
};

export type BriefMatchup = {
  id: string;
  week: number;
  home: boolean;
  my_points: number;
  opp_points: number;
  my_proj: number;
  opp_proj: number;
  /** Projection from starters whose game has not kicked yet. */
  my_proj_left: number;
  opp_proj_left: number;
  my_starters: BriefStarter[];
  opp_starters: BriefStarter[];
  my_empty_slots: number;
  opponent: BriefTeam;
};

export type BriefLast = {
  week: number;
  /** The recapped game, for the share link; `matchup` is the week ahead. */
  matchup_id: string;
  my_points: number;
  opp_points: number;
  opponent: { team_id: string; name: string; manager_name: string | null; logo_path: string | null };
  league_high: { team_id: string; name: string; manager_name: string | null; points: number } | null;
  my_week_rank: number;
  top_scorer: { full_name: string; position: string; points: number } | null;
  /** Every result of that week. By Tuesday `board` has moved on to the next. */
  board: BoardRow[];
};

export type BriefHistory = {
  wins?: number;
  losses?: number;
  ties?: number;
  games?: number;
  streak?: StreakOf;
  last?: { season: number; week: number; round: string; my: number; theirs: number; won: boolean } | null;
  playoff_meetings?: number;
  seasons_on_file: number;
};

export type BoardRow = {
  id: string;
  week: number;
  home_team_id: string;
  away_team_id: string;
  home_points: number;
  away_points: number;
  home_proj: number;
  away_proj: number;
  mine: boolean;
};

/* ------------------------------------------------------------ clubhouse -- */
/** Shape of ff_clubhouse_feed(league_id, limit) — the room, for the front page. */

export type RoomLine = {
  id: string;
  body: string;
  created_at: string;
  author: string;
  mine: boolean;
  matchup_id: string | null;
  /** The game it was said about, when it was said on a matchup card. */
  about: { week: number; home: string; away: string; mine: boolean } | null;
};

export type RoomFeed = {
  /** The thread on my own table this week. Null when I have no game. */
  mine: {
    matchup_id: string;
    week: number;
    count: number;
    last: { body: string; created_at: string; author: string; mine: boolean } | null;
  } | null;
  recent: RoomLine[];
  count_7d: number;
  now: string;
};

/**
 * What the room has to say for itself, in one line.
 *
 * The empty case is the important one: a league that has never said anything
 * needs an invitation, not a zero. Everything else is a volume reading, which
 * is what tells a manager whether opening the clubhouse is worth the tap.
 */
export function roomLine(f: RoomFeed | null): string {
  if (!f) return "";
  if (f.recent.length === 0) return "Nobody has said anything yet. Somebody has to go first.";
  if (f.count_7d === 0) return "Quiet this week.";
  return `${f.count_7d} line${f.count_7d === 1 ? "" : "s"} this week.`;
}

/** "three about your table", for the card's own thread. */
export function aboutMyTable(f: RoomFeed | null): string | null {
  const n = f?.mine?.count ?? 0;
  if (n === 0) return null;
  return `${n} about your table`;
}

export type Briefing = {
  league: {
    id: string;
    name: string;
    season: number;
    team_count: number;
    regular_season_weeks: number;
    playoff_teams: number;
    playoff_byes: number;
    waiver_run_day: string;
    is_commissioner: boolean | null;
  };
  week: number;
  me: (BriefTeam & { draft_slot: number | null; streak: StreakOf }) | null;
  draft: {
    id: string;
    status: "setup" | "active" | "paused" | "complete";
    current_pick: number;
    pick_deadline: string | null;
    picks_total: number;
    on_clock_team_id: string | null;
    started_at: string | null;
    completed_at: string | null;
  } | null;
  games: {
    week: number;
    first_kick: string | null;
    last_kick: string | null;
    total: number;
    final: number;
    in_progress: number;
    next_kickoff: string | null;
    last_final_at: string | null;
  };
  matchup: BriefMatchup | null;
  last: BriefLast | null;
  history: BriefHistory;
  standings: BriefTeam[];
  board: BoardRow[];
  lineup: {
    starters: number;
    slots: number;
    empty_slots: number;
    on_bye: string[];
    hurt: { full_name: string; severity: string }[];
    has_roster: boolean;
  } | null;
  teams: { id: string; name: string; manager_name: string | null; logo_path: string | null }[];
  now: string;
  generated_at: string;
};

/* ----------------------------------------------------------------- phase -- */

/**
 * The personality the screen wears. Same URL every day; a different card.
 *
 *   unlinked   signed in, but no team in this league
 *   draft      the board is not full yet
 *   preseason  schedule posted, week 1 not kicked, nothing to recap
 *   live       a game is on somewhere in the league
 *   monday     my table is not settled and the only football left is tonight
 *   settled    both lineups are done; the league's week is not
 *   recap      Tuesday: last week's result, and what it meant
 *   waivers    Wednesday: claims run tonight
 *   lineup     Thursday to kickoff: set the table
 */
export type Phase =
  | "unlinked" | "draft" | "preseason" | "live" | "monday" | "settled" | "recap" | "waivers" | "lineup";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Day of the week where the league lives, 0 = Sunday. Never the phone's zone. */
export function weekdayIn(now: number, tz = LEAGUE_TZ): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" })
    .format(new Date(now)).toLowerCase();
  const i = DAYS.indexOf(name);
  return i === -1 ? new Date(now).getDay() : i;
}

const remaining = (s: BriefStarter[]) => s.filter((p) => !p.final);
const playing = (s: BriefStarter[]) => s.filter((p) => p.game_status === "in");

export function phaseOf(b: Briefing, now: number): Phase {
  if (!b.me) return "unlinked";
  if (b.draft && b.draft.status !== "complete") return "draft";

  const g = b.games;
  const weekDone = g.total > 0 && g.final >= g.total;
  const day = weekdayIn(now);
  const m = b.matchup;

  if (g.in_progress > 0) return "live";
  if (weekDone && b.last) return "recap";

  // Nothing has kicked in this week yet.
  if (g.final === 0) {
    if (day === 2 && b.last) return "recap";
    if (day === 3 && b.last && b.league.waiver_run_day === "wednesday") return "waivers";
    if (!b.last && b.week <= 1 && !m) return "preseason";
    if (!b.last && b.week <= 1 && m && (b.lineup?.starters ?? 0) === 0) return "preseason";
    return "lineup";
  }

  // Part of the week is in the books.
  if (m) {
    const mineLeft = remaining(m.my_starters).length + remaining(m.opp_starters).length;
    if (mineLeft === 0) return "settled";
    if (day === 1 || (day === 0 && g.total - g.final <= 1)) return "monday";
  }
  return "lineup";
}

/* ------------------------------------------------------------- language -- */

/** "Dave" if the commissioner typed a name; the team otherwise. */
export const who = (t: { manager_name: string | null; name: string } | null | undefined) =>
  t ? (t.manager_name?.trim().split(/\s+/)[0] || t.name) : "—";

export const fmt = (n: number | null | undefined) => Number(n ?? 0).toFixed(1);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const words = (n: number) => WORDS[n] ?? String(n);
const ORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordWord = (n: number) => ORDS[n] ?? ordinal(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** "Sun 1:00 PM", in the league's zone. */
export function fmtKick(iso: string | null | undefined, tz = LEAGUE_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

/** "in 2h 14m", "in 3 days", "now". */
export function until(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `in ${plural(d, "day")}`;
}

/* -------------------------------------------------------------- headline -- */

export type Headline = { eyebrow: string; title: string; sub?: string };

export function headline(b: Briefing, phase: Phase): Headline {
  const wk = `Week ${b.week}`;
  const m = b.matchup;
  const opp = m ? who(m.opponent) : null;

  switch (phase) {
    case "unlinked":
      return { eyebrow: b.league.name, title: "No table reserved.", sub: "This account isn't on a team yet." };
    case "draft": {
      const d = b.draft!;
      const onClock = b.teams.find((t) => t.id === d.on_clock_team_id);
      if (d.status === "active") {
        return {
          eyebrow: `Draft · pick ${d.current_pick} of ${d.picks_total}`,
          title: onClock?.id === b.me?.team_id ? "You're on the clock." : `${onClock?.name ?? "Someone"} is on the clock.`,
        };
      }
      if (d.status === "paused") return { eyebrow: "Draft night", title: "The room is paused." };
      return { eyebrow: `${b.league.season} season`, title: "Draft night is coming." };
    }
    case "preseason":
      return { eyebrow: `${wk} · ${b.league.name}`, title: m ? `You vs. ${opp}.` : "The table is set." };
    case "recap": {
      const l = b.last!;
      const won = l.my_points > l.opp_points;
      const tied = l.my_points === l.opp_points;
      return {
        eyebrow: `Week ${l.week} · Final`,
        title: tied ? `You tied ${who(l.opponent)}.` : won ? `You beat ${who(l.opponent)}.` : `${who(l.opponent)} got you.`,
      };
    }
    case "settled": {
      const won = m!.my_points > m!.opp_points;
      return { eyebrow: `${wk} · Settled`, title: won ? `You beat ${opp}.` : `${opp} got you.` };
    }
    case "live":
      return { eyebrow: `${wk} · Live`, title: m ? `You vs. ${opp}` : "Sunday at the Steakhouse." };
    case "monday":
      return { eyebrow: `${wk} · Monday night`, title: `You vs. ${opp}` };
    case "waivers":
      return { eyebrow: `${wk} · Waivers`, title: m ? `You vs. ${opp}` : wk };
    default:
      return { eyebrow: wk, title: m ? `You vs. ${opp}` : "No game this week." };
  }
}

/* ------------------------------------------------------------ narrative -- */

/** The line from the book: all-time against this opponent. */
function historyLine(b: Briefing): string | null {
  const m = b.matchup;
  const h = b.history;
  if (!m || h.games === undefined) return null;
  const opp = who(m.opponent);
  const s = h.streak;
  if (s && s.n >= 2 && s.kind === "L") return `You've dropped ${words(s.n)} straight to ${opp}. Sunday's the rematch.`;
  if (s && s.n >= 2 && s.kind === "W") return `You've taken ${words(s.n)} straight from ${opp}.`;
  if ((h.games ?? 0) > 0 && h.last) {
    const rec = `${h.wins}–${h.losses}${h.ties ? `–${h.ties}` : ""}`;
    const margin = Math.abs(h.last.my - h.last.theirs).toFixed(1);
    const when = h.last.season === b.league.season ? `in week ${h.last.week}` : `in ${h.last.season}`;
    const round = h.last.round === "final" ? " final" : h.last.round === "semifinal" ? " semifinal" : "";
    return `You're ${rec} against ${opp} all-time. Last time, ${h.last.won ? "you" : "he"} took it by ${margin} ${when}${round ? `'s${round}` : ""}.`;
  }
  if (h.seasons_on_file > 0) return `First time you've drawn ${opp} in the book.`;
  return null;
}

/** What a win would do to the table. */
function standingLine(b: Briefing): string | null {
  const me = b.me;
  const m = b.matchup;
  if (!me || !m || me.seed == null) return null;
  const played = me.wins + me.losses + me.ties;
  if (played === 0) return null;
  const opp = m.opponent;
  const others = b.standings.filter((t) => t.team_id !== me.team_id);
  const top = b.league.playoff_teams;

  if (me.seed === 1) {
    const tied = others.filter((t) => t.wins === me.wins).length;
    return tied > 0 ? "Win and you're alone in first." : "Win and you stay on top.";
  }
  if (opp.seed != null && opp.seed < me.seed && opp.wins - me.wins <= 1) {
    return `Win and you jump ${who(opp)} in the standings.`;
  }
  if (me.seed === top + 1) return "Win and you're back inside the playoff line.";
  if (me.seed === top) return "A win keeps you inside the playoff line.";
  if (me.seed <= b.league.playoff_byes && b.league.playoff_byes > 0) return "A win keeps your bye in hand.";
  return null;
}

function streakLine(b: Briefing): string | null {
  const s = b.me?.streak;
  if (!s || s.n < 3 || !s.kind) return null;
  if (s.kind === "W") return `You've won ${words(s.n)} in a row.`;
  if (s.kind === "L") return `${cap(words(s.n))} straight losses. Time to stop the bleeding.`;
  return null;
}

/** The state of a live or Monday table in one sentence. */
function liveLine(b: Briefing): string | null {
  const m = b.matchup;
  if (!m) return null;
  const opp = who(m.opponent);
  const diff = m.my_points - m.opp_points;
  const mine = remaining(m.my_starters);
  const theirs = remaining(m.opp_starters);
  const up = diff > 0;
  const gap = Math.abs(diff).toFixed(1);

  if (mine.length === 0 && theirs.length === 0) {
    return up ? `Final, pending the league's last game: you by ${gap}.` : `Final, pending the league's last game: ${opp} by ${gap}.`;
  }
  if (mine.length === 1 && theirs.length === 0) {
    const p = mine[0];
    const last = p.full_name.split(" ").slice(-1)[0];
    if (!up) return `You need ${(-diff + 0.1).toFixed(1)} from ${last}. He's projected ${fmt(p.projection)}.`;
    return `You're up ${gap} with ${last} still to play. ${opp}'s done.`;
  }
  if (mine.length === 0 && theirs.length === 1) {
    const p = theirs[0];
    const last = p.full_name.split(" ").slice(-1)[0];
    if (up) return `You're up ${gap}. ${opp} needs ${(diff + 0.1).toFixed(1)} from ${last}, projected ${fmt(p.projection)}.`;
    return `${opp}'s up ${gap} and still has ${last} to play. It's over unless he lays an egg.`;
  }
  if (mine.length === 1 && theirs.length === 1) {
    const a = mine[0].full_name.split(" ").slice(-1)[0];
    const c = theirs[0].full_name.split(" ").slice(-1)[0];
    return `${a} against ${c} tonight decides it. You're ${up ? "up" : "down"} ${gap}.`;
  }
  const live = playing(m.my_starters).length + playing(m.opp_starters).length;
  const you = `${mine.length === 1 ? "one player" : `${words(mine.length)} players`} left`;
  const them = `${opp} has ${mine.length === theirs.length ? "the same" : theirs.length === 0 ? "none" : words(theirs.length)}`;
  if (diff === 0) return `All square with ${you}; ${them}.`;
  return `${up ? "Up" : "Down"} ${gap} with ${you}; ${them}.${live ? "" : " Nothing on right now."}`;
}

function recapLine(b: Briefing): string | null {
  const l = b.last;
  if (!l) return null;
  const opp = who(l.opponent);
  const diff = l.my_points - l.opp_points;
  const won = diff > 0;
  const margin = Math.abs(diff).toFixed(1);
  const parts: string[] = [];

  if (diff === 0) parts.push(`A dead heat with ${opp}, ${fmt(l.my_points)} apiece.`);
  else if (Math.abs(diff) < 3) parts.push(won ? `You edged ${opp} by ${margin}.` : `${opp} edged you by ${margin}.`);
  else if (Math.abs(diff) > 40) parts.push(won ? `You ran ${opp} out of the building by ${margin}.` : `${opp} ran you out of the building by ${margin}.`);
  else parts.push(won ? `You took it by ${margin}.` : `He took it by ${margin}.`);

  const s = b.me?.streak;
  if (s && s.n >= 2 && s.kind === "W") parts.push(`${cap(ordWord(s.n))} straight win.`);
  else if (s && s.n >= 2 && s.kind === "L") parts.push(`${cap(ordWord(s.n))} straight loss.`);
  else if (l.top_scorer && won) parts.push(`${l.top_scorer.full_name.split(" ").slice(-1)[0]} carried it with ${fmt(l.top_scorer.points)}.`);

  if (l.my_week_rank === 1) parts.push("Top score in the league.");
  else if (l.league_high && l.league_high.team_id !== b.me?.team_id) {
    parts.push(`League high: ${who(l.league_high)}, ${fmt(l.league_high.points)}.`);
  }
  return parts.slice(0, 3).join(" ");
}

function draftLine(b: Briefing, now: number): string {
  const d = b.draft!;
  if (d.status === "active") {
    const me = d.on_clock_team_id === b.me?.team_id;
    const left = d.pick_deadline ? Math.max(0, Math.round((new Date(d.pick_deadline).getTime() - now) / 1000)) : null;
    return me
      ? `Pick ${d.current_pick} is yours${left !== null ? ` — ${left}s on the clock` : ""}.`
      : `Pick ${d.current_pick} of ${d.picks_total}. ${d.picks_total - d.current_pick + 1} to go.`;
  }
  if (d.status === "paused") return "Nobody can pick until the commissioner resumes. Queue up while it's quiet.";
  return `${b.league.team_count} managers, ${d.picks_total} picks, one board. Your queue is the plan when the clock runs out.`;
}

/**
 * One line of truth. Ordered by what matters on the day: the score when a
 * game is on, the result on Tuesday, the book and the table the rest of
 * the week.
 */
export function narrative(b: Briefing, phase: Phase, now: number): string {
  switch (phase) {
    case "unlinked":
      return "Ask the commissioner to put your email on a team, then sign in again.";
    case "draft":
      return draftLine(b, now);
    case "preseason":
      return b.games.next_kickoff
        ? `Kickoff ${until(b.games.next_kickoff, now)}. Every lineup locks at its player's game, not at noon.`
        : "The schedule posts the moment the draft finishes.";
    case "live":
    case "monday":
    case "settled":
      return liveLine(b) ?? "The scoreboard is live.";
    case "recap":
      return recapLine(b) ?? "The week is in the books.";
    default: {
      const lines = [historyLine(b), standingLine(b), streakLine(b)].filter(Boolean) as string[];
      if (lines.length) return lines.slice(0, 2).join(" ");
      if (!b.matchup) return "You draw a bye this week. Scout the room.";
      const played = (b.me?.wins ?? 0) + (b.me?.losses ?? 0);
      return played === 0 ? "Week one. Everybody's undefeated until Sunday." : `Kickoff ${until(b.games.next_kickoff, now)}.`;
    }
  }
}

/* ---------------------------------------------------------------- action -- */

export type Action = { label: string; href?: string; kind?: "link" | "share"; urgent?: boolean };

/** The one thing to do today. Never two. */
export function action(b: Briefing, phase: Phase): Action | null {
  const lu = b.lineup;
  switch (phase) {
    case "unlinked":
      return { label: "See the league", href: "/league" };
    case "draft":
      return b.draft?.status === "active"
        ? { label: b.draft.on_clock_team_id === b.me?.team_id ? "Make your pick" : "Enter the draft room", href: "/draft", urgent: b.draft.on_clock_team_id === b.me?.team_id }
        : { label: "Draft room", href: "/draft" };
    case "live":
      return { label: "Watch it live", href: "/matchups" };
    case "monday":
      return { label: "Watch Monday night", href: "/matchups" };
    case "settled":
    case "recap":
      return { label: "Send the recap to the chat", kind: "share" };
    case "waivers":
      return { label: "Work the waiver wire", href: "/players" };
    case "preseason":
      return lu?.has_roster ? { label: "Set your week 1 lineup", href: "/team" } : { label: "See your team", href: "/team" };
    default: {
      if (!lu) return { label: "See your team", href: "/team" };
      if (lu.empty_slots > 0) return { label: `Fill ${plural(lu.empty_slots, "empty slot")}`, href: "/team", urgent: true };
      const out = lu.hurt.find((h) => h.severity === "out" || h.severity === "doubtful");
      if (out) return { label: `${out.full_name.split(" ").slice(-1)[0]} is ${out.severity} — fix your lineup`, href: "/team", urgent: true };
      if (lu.on_bye.length) return { label: `${lu.on_bye[0].split(" ").slice(-1)[0]} is on bye — swap him`, href: "/team", urgent: true };
      const q = lu.hurt.find((h) => h.severity === "questionable");
      if (q) return { label: `Check on ${q.full_name.split(" ").slice(-1)[0]}`, href: "/team" };
      return { label: "Lineup's set — read the wire", href: "/team" };
    }
  }
}

/* ----------------------------------------------------------------- recap -- */

/**
 * The weekly recap, written for the group chat. Plain text with line
 * breaks, because that is what iMessage and WhatsApp render.
 */
export function recapText(b: Briefing, origin: string): string {
  const nameOf = (id: string) => b.teams.find((t) => t.id === id);
  const week = b.last?.week ?? b.week;
  const lines: string[] = [`${b.league.name} · Week ${week}`];

  // Last week's results come with `last`; `board` is already the week ahead.
  const rows = (b.last?.board ?? b.board).filter((r) => r.week === week);
  for (const r of rows) {
    const h = nameOf(r.home_team_id), a = nameOf(r.away_team_id);
    const hp = Number(r.home_points), ap = Number(r.away_points);
    const [w, l, wp, lp] = hp >= ap ? [h, a, hp, ap] : [a, h, ap, hp];
    lines.push(`${who(w)} ${fmt(wp)} — ${who(l)} ${fmt(lp)}`);
  }

  if (b.last?.league_high) {
    lines.push("", `Tonight's Specials: ${who(b.last.league_high)}, ${fmt(b.last.league_high.points)} points.`);
  }
  const link = b.last?.matchup_id ?? b.matchup?.id;
  if (link) lines.push(`${origin}/share/matchup/${link}`);
  return lines.join("\n");
}

/** One matchup, for a share sheet. */
export function matchupText(b: Briefing, origin: string): string {
  const m = b.matchup;
  if (!m || !b.me) return `${b.league.name} · Week ${b.week}`;
  const me = who(b.me), opp = who(m.opponent);
  const live = m.my_points + m.opp_points > 0;
  const line = live
    ? `${me} ${fmt(m.my_points)} — ${opp} ${fmt(m.opp_points)}`
    : `${me} (proj. ${fmt(m.my_proj)}) vs. ${opp} (proj. ${fmt(m.opp_proj)})`;
  return `${b.league.name} · Week ${b.week}\n${line}\n${origin}/share/matchup/${m.id}`;
}
