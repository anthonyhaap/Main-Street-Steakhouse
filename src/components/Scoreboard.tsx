"use client";

/**
 * The Sunday board.
 *
 * What was here before was a schedule: two names, two numbers, and a caret.
 * True, and nearly useless — the numbers a manager actually watches are the
 * ones that say where the game is *going*. So every card now carries the
 * projected final, a win probability that collapses to a certainty as the
 * games end, who is still to play, who is carrying the day, and one sentence
 * that says the thing out loud.
 *
 * Hierarchy, because everything mattering equally is the same as nothing
 * mattering: your game is one card, at the top, three times the size. The
 * other five are a list. That is the whole layout decision.
 *
 * Presentational only. It takes the `ff_scoreboard` payload and a clock, and
 * owns nothing but which card is expanded — so `/preview/matchups` renders a
 * whole invented Sunday through it without a session.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Flame, Maximize2, Share2, TriangleAlert } from "lucide-react";
import { PlayerBadge } from "@/components/PlayerBadge";
import { crestUrl } from "@/lib/crest";
import { Seal, useCountUp } from "@/components/ui";
import {
  benchOf, boxScoreLine, cardLine, cardState, gameMark, hasProblem, kickLabel, leader,
  pctLabel, projectedFinal, stillToPlay, topPerformer, versusProjection, winOdds, fmt1,
  type ScoreCard, type ScoreSide, type ScoreStarter, type Scoreboard as Board,
  type WinOdds,
} from "@/lib/scoreboard";

export function Scoreboard({ board, now, talk, rivalry, onShare }: {
  board: Board;
  now: number;
  /**
   * The thread for a card. A slot rather than a component, because the live
   * one fetches and posts and this file has to stay renderable from a fixture
   * — `/preview/matchups` passes a read-only thread through the same hole.
   */
  talk?: (c: ScoreCard) => React.ReactNode;
  /** The head-to-head record, same reason: a slot, filled from one call. */
  rivalry?: (c: ScoreCard) => React.ReactNode;
  /**
   * Send this card to the group chat. A slot again, because the share sheet
   * and the clipboard are browser APIs a fixture must not call.
   */
  onShare?: (c: ScoreCard) => void;
}) {
  const mine = board.matchups.find((m) => m.mine) ?? null;
  const rest = board.matchups.filter((m) => m !== mine);

  return (
    <>
      {mine && (
        <Card key={mine.id} c={mine} now={now} myTeamId={board.my_team_id}
              talk={talk} rivalry={rivalry} onShare={onShare} hero />
      )}
      {rest.length > 0 && (
        <section className="sb-rest" aria-label="The rest of the league">
          <div className="room__head">
            <span className="eyebrow">{mine ? "Around the room" : `Week ${board.week}`}</span>
            <span className="eyebrow">{rest.length} table{rest.length === 1 ? "" : "s"}</span>
          </div>
          <div className="sb-list">
            {rest.map((c) => (
              <Card key={c.id} c={c} now={now} myTeamId={board.my_team_id}
                    talk={talk} rivalry={rivalry} onShare={onShare} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ card -- */

function Card({ c, now, myTeamId, talk, rivalry, onShare, hero = false }: {
  c: ScoreCard;
  now: number;
  myTeamId: string | null;
  talk?: (c: ScoreCard) => React.ReactNode;
  rivalry?: (c: ScoreCard) => React.ReactNode;
  onShare?: (c: ScoreCard) => void;
  hero?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const state = cardState(c);
  const odds = winOdds(c);
  // Before the draft there are two teams, no lineups and nothing to model.
  // An odds bar reading 50–50 over that is the standings' preseason mistake
  // in a different shape.
  const lineups = c.home.starters.length + c.away.starters.length > 0;
  // One answer, from the library, so this card and the full-screen matchup's
  // header can never gild a different name.
  const ahead = leader(c);
  const lead = { home: ahead === "home", away: ahead === "away" };

  return (
    <article className="sb" data-hero={hero} data-mine={c.mine} data-state={state}>
      <header className="sb__top">
        <StateChip state={state} c={c} now={now} />
        {hero && c.mine && <span className="eyebrow" data-tone="gold">Your table</span>}
        {/* The list view is a scroll of every game; the full-screen matchup is
            one of them at a time, lineup already open, reachable from here and
            from the ticker or its own dropdown once you're on it. */}
        {lineups && (
          <Link
            href={`/matchups/${c.id}?week=${c.week}`}
            className="sb__share"
            aria-label="Open this matchup full screen"
            title="Open this matchup full screen"
          >
            <Maximize2 size={14} />
          </Link>
        )}
        {/* The card already has a public page with an opengraph image behind
            it; until now the only way to reach it was the Tuesday recap on the
            front page, which is not where anybody is sitting when the thing
            worth sending happens. */}
        {onShare && (
          <button
            className="sb__share"
            onClick={() => onShare(c)}
            aria-label="Send this game to the chat"
            title="Send this game to the chat"
          >
            <Share2 size={14} />
          </button>
        )}
      </header>

      <div className="sb__sides">
        <Side s={c.away} lead={lead.away} hero={hero} state={state} lineups={lineups} />
        <span className="sb__vs" aria-hidden>vs</span>
        <Side s={c.home} lead={lead.home} hero={hero} state={state} lineups={lineups} />
      </div>

      {lineups && <Odds c={c} odds={odds} state={state} />}

      <p className="sb__line">{cardLine(c, myTeamId)}</p>

      {/* Directly under the sentence about today's game, because it is the
          same sentence about every other time these two have played. */}
      {rivalry?.(c)}

      {hero && lineups && (
        <div className="sb__strip">
          <Stat label="Projected final" value={`${fmt1(projectedFinal(c.away))} – ${fmt1(projectedFinal(c.home))}`} />
          <Stat
            label="Still to play"
            value={`${c.away.yet_to_play} – ${c.home.yet_to_play}`}
            foot={c.away.in_action + c.home.in_action > 0
              ? `${c.away.in_action + c.home.in_action} in action now`
              : "nobody on right now"}
          />
          <Stat
            label="Against projection"
            value={pace(c, myTeamId)}
            foot="how the day is running versus what was expected"
          />
        </div>
      )}

      {/* Before kickoff nobody has carried anything, and a row of em dashes is
          worse than no row. */}
      {(topPerformer(c.away) || topPerformer(c.home)) && (
        <div className="sb__tops">
          <TopLine s={c.away} />
          <TopLine s={c.home} />
        </div>
      )}

      {lineups && (
        <button className="sb__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {open ? "Hide both lineups" : "Both lineups"}
        </button>
      )}

      {open && <VsLineups away={c.away} home={c.home} now={now} />}

      {/* Last, because it is the one thing on the card that grows. */}
      {talk?.(c)}
    </article>
  );
}

/* ------------------------------------------------------------------ side -- */

function Side({ s, lead, hero, state, lineups }: {
  s: ScoreSide; lead: boolean; hero: boolean; state: string; lineups: boolean;
}) {
  const shown = useCountUp(Number(s.points));
  const proj = projectedFinal(s);
  const problem = hasProblem(s);

  return (
    <div className="sb__side" data-lead={lead} data-mine={s.mine}>
      <div className="sb__who">
        <Seal name={s.name} src={crestUrl(s.logo_path)} mine={s.mine} size={hero ? 40 : 28} />
        <span className="sb__id">
          <b>{s.name}</b>
          <i>
            {s.manager_name ? `${s.manager_name} · ` : ""}
            {s.wins}–{s.losses}{s.ties ? `–${s.ties}` : ""}
          </i>
        </span>
      </div>
      <div className="sb__pts">
        {/* No roster is not a projection of nothing; it is no projection. */}
        <b className="num">{!lineups ? "—" : state === "pre" ? fmt1(s.proj) : shown.toFixed(1)}</b>
        <span className="sb__proj">
          {!lineups ? "" : state === "pre" ? "projected"
            // Nobody left to play: the score is the projection, and printing
            // it twice only invites the question of why they differ.
            : s.yet_to_play === 0 ? "final"
            : `proj. ${fmt1(proj)}`}
        </span>
      </div>
      {problem && (
        <span className="sb__flag" title="This lineup has a hole in it">
          <TriangleAlert size={12} />
          {s.empty_slots > 0
            ? `${s.empty_slots} empty slot${s.empty_slots === 1 ? "" : "s"}`
            : "lineup problem"}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ odds -- */

/**
 * The win probability, as a bar and as two numbers. Never the bar alone: the
 * split is also stated in text, so the card reads the same to someone who
 * cannot separate wine from gold.
 */
export function Odds({ c, odds, state }: { c: ScoreCard; odds: WinOdds; state: string }) {
  const label = state === "pre" ? "Projected to win" : odds.settled ? "Result" : "Win probability";
  return (
    <div className="sb__odds">
      <div className="sb__odds-head">
        <span className="eyebrow">{label}</span>
        <span className="sb__odds-src">
          {odds.settled ? "settled" : "from the projected remainder"}
        </span>
      </div>
      <div
        className="sb__bar"
        role="img"
        aria-label={`${c.away.name} ${pctLabel(odds.away)}, ${c.home.name} ${pctLabel(odds.home)}`}
      >
        <i data-side="away" style={{ width: `${odds.away}%` }} />
        <i data-side="home" style={{ width: `${odds.home}%` }} />
      </div>
      <div className="sb__odds-nums">
        <span className="num" data-on={odds.away >= 50}>{pctLabel(odds.away)}</span>
        <span className="num" data-on={odds.home >= 50}>{pctLabel(odds.home)}</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- parts -- */

export function StateChip({ state, c, now }: { state: string; c: ScoreCard; now: number }) {
  if (state === "live") {
    const on = c.home.in_action + c.away.in_action;
    return <span className="badge" data-tone="live">Live · {on} player{on === 1 ? "" : "s"} in action</span>;
  }
  if (state === "settled") return <span className="badge" data-tone="neutral">Final</span>;
  if (state === "between") {
    const left = c.home.yet_to_play + c.away.yet_to_play;
    return <span className="badge" data-tone="warn">{left} still to play</span>;
  }
  const next = stillToPlay(c.away).concat(stillToPlay(c.home))
    .map((p) => p.kickoff_at).filter(Boolean).sort()[0] ?? null;
  return (
    <span className="badge" data-tone="neutral">
      {next ? `First kick ${kickLabel(next, now)}` : "Not kicked"}
    </span>
  );
}

function Stat({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div className="sb__stat">
      <b className="num">{value}</b>
      <span className="sb__stat-label">{label}</span>
      {foot && <span className="sb__stat-foot">{foot}</span>}
    </div>
  );
}

/** How the viewer's day is running against what was expected of it. */
function pace(c: ScoreCard, myTeamId: string | null): string {
  const me = myTeamId === c.home.team_id ? c.home : myTeamId === c.away.team_id ? c.away : c.away;
  const d = versusProjection(me);
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}

function TopLine({ s }: { s: ScoreSide }) {
  const top = topPerformer(s);
  if (!top) return <span className="sb__top-none">—</span>;
  return (
    <span className="sb__top-perf" title={`${s.name}'s best day so far`}>
      <Flame size={12} />
      <b>{top.full_name}</b>
      <span className="num">{fmt1(top.points)}</span>
    </span>
  );
}

/**
 * Both lineups, one slot at a time.
 *
 * Away and home go side by side, mirrored against each other so their scores
 * land either side of one shared position pill — the ESPN matchup screen this
 * whole table takes its shape from. A full-width box per player (stacked
 * away-then-home) had a turn: it solved the squeeze by refusing it, but it
 * also meant reading one whole side of a slot before the other, which is not
 * how a manager compares two players in the same spot.
 *
 * What changed for the full-screen matchup is what a row says without being
 * asked. It used to print the box score under every name, always — nine slots
 * times two sides times "18/24, 245 YD, 2 TD" is a row and a half apiece, and
 * the matchup the screen exists for ended up below the fold. So the stat line
 * moved behind a tap: the default row is a name, a game state, a score and a
 * projection, and the line the score was made of arrives under the row when
 * somebody asks for it.
 *
 * The tap is `PlayerBadge`'s own `onOpen`, which the draft room added for the
 * same reason — a plain click does the thing that belongs on this screen, and
 * a cmd-click, a middle click or "open in new tab" still reach the player's
 * page, because that page is a location and losing it would be a regression
 * dressed as a redesign.
 */
export function VsLineups({ away, home, now, head, bench = false }: {
  away: ScoreSide; home: ScoreSide; now: number;
  /**
   * What sits between the two team names: the "Lineups" label by default.
   * `null` drops the whole header row, which is what the full-screen matchup
   * wants — the scoreboard above it already names both teams and both
   * scores, twice.
   */
  head?: React.ReactNode;
  /**
   * Offer the benches under the starters, collapsed. Off on the list page,
   * where a card is a comparison of two lineups and who sat is somebody
   * else's question; on for the full-screen matchup, where "should he have
   * started somebody else" is half of what the screen is read for.
   */
  bench?: boolean;
}) {
  // One set for both sides: a row is a slot, and the two men in it are read
  // together, so asking for one man's line offers the other's in the same
  // breath rather than making it two taps.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const [benchOpen, setBenchOpen] = useState(false);
  const benches = { away: benchOf(away), home: benchOf(home) };
  const benchRows = Math.max(benches.away.length, benches.home.length);

  if (away.starters.length === 0 && home.starters.length === 0) {
    return <div className="sb__vs-lineup"><div className="empty">No lineup set.</div></div>;
  }
  const rows = Math.max(away.starters.length, home.starters.length);

  return (
    <div className="sb__vs-lineup">
      {/* `head === null` means "no header row at all" — the full-screen
          matchup, where the scoreboard above this table and the sticky bar
          above that have both already said which two teams these are and
          what they are on. A third copy would cost a row of the one budget
          that screen is short of. */}
      {head !== null && (
        <div className="sb__vs-head">
          <VsTeam s={away} />
          {head ?? <span className="eyebrow">Lineups</span>}
          <VsTeam s={home} align="end" />
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => {
        const a = away.starters[i], h = home.starters[i];
        return (
          <VsSlot
            key={a?.player_id ?? h?.player_id ?? i}
            a={a} h={h} now={now} slot={a?.slot ?? h?.slot} open={open} toggle={toggle}
          />
        );
      })}

      {bench && benchRows > 0 && (
        <>
          <button
            className="sb__bench-toggle"
            onClick={() => setBenchOpen((v) => !v)}
            aria-expanded={benchOpen}
          >
            {benchOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Bench
            <span className="num">{benches.away.length} · {benches.home.length}</span>
          </button>
          {benchOpen && Array.from({ length: benchRows }, (_, i) => {
            const a = benches.away[i], h = benches.home[i];
            return (
              <VsSlot
                key={a?.player_id ?? h?.player_id ?? `bn-${i}`}
                a={a} h={h} now={now} open={open} toggle={toggle} bench
              />
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * One slot: the two men in it, and — only once somebody asks — what their
 * scores were made of.
 *
 * The stat lines sit in their own row under the pair rather than inside each
 * cell, so one side expanding cannot drag the shared position pill off the
 * centre line of the other side's name.
 */
function VsSlot({ a, h, now, slot, open, toggle, bench = false }: {
  a?: ScoreStarter; h?: ScoreStarter; now: number; slot?: string;
  open: ReadonlySet<string>; toggle: (id: string) => void; bench?: boolean;
}) {
  const aOpen = !!a && open.has(a.player_id) && !!boxScoreLine(a);
  const hOpen = !!h && open.has(h.player_id) && !!boxScoreLine(h);

  return (
    <div className="sb__vs-slot" data-bench={bench || undefined}>
      <div className="sb__vs-row">
        <VsPlayer p={a} now={now} align="start" bench={bench} open={open} toggle={toggle} />
        {/* A starter's row is one slot with two men in it, so the pill in the
            middle names the slot both of them are filling. The bench has no
            such correspondence — index four on one side has nothing to do
            with index four on the other — so it says nothing rather than
            claiming a pairing that isn't there, and each cell carries its own
            position instead. */}
        {bench
          ? <span className="sb__vs-spacer" aria-hidden />
          : <span className="pos" data-p={slot}>{slot}</span>}
        <VsPlayer p={h} now={now} align="end" bench={bench} open={open} toggle={toggle} />
      </div>
      {(aOpen || hOpen) && (
        <div className="sb__vs-detail">
          <span className="sb__box">{aOpen && boxScoreLine(a!)}</span>
          <span />
          <span className="sb__box" data-align="end">{hOpen && boxScoreLine(h!)}</span>
        </div>
      )}
    </div>
  );
}

function VsTeam({ s, align = "start" }: { s: ScoreSide; align?: "start" | "end" }) {
  return (
    <span className="sb__vs-team" data-align={align}>
      <b>{s.name}</b>
      <span className="num">{fmt1(s.points)}</span>
    </span>
  );
}

function VsPlayer({ p, now, align, bench, open, toggle }: {
  p?: ScoreStarter; now: number; align: "start" | "end"; bench: boolean;
  open: ReadonlySet<string>; toggle: (id: string) => void;
}) {
  if (!p) return <span className="sb__vs-cell" data-align={align} />;
  const mark = gameMark(p, now);
  // Nothing to disclose until he has a stat line, and a control that does
  // nothing is worse than no control.
  const box = boxScoreLine(p);
  const shown = open.has(p.player_id);

  return (
    <div className="sb__vs-cell" data-align={align} data-final={p.final} data-bye={p.on_bye}>
      <PlayerBadge
        id={p.player_id}
        name={p.full_name}
        displayName={vsDisplayName(p)}
        position={p.position}
        team={p.nfl_team}
        espnId={p.espn_id}
        size={24}
        onOpen={box ? () => toggle(p.player_id) : undefined}
        sub={
          <>
            {/* On the bench the slot pill is gone from the middle of the row,
                so the position comes back here, where it is the first thing
                worth knowing about a man who did not play. */}
            {bench && <b className="sb__vs-pos" data-p={p.position}>{p.position}</b>}
            <span className="sb__mark" data-state={mark.state}>
              {mark.state === "live" && <i className="sb__pip" aria-hidden />}
              {mark.label}
              {mark.detail && <em className="sb__clock">{mark.detail}</em>}
              {p.severity === "out" && <b className="sb__hurt"> · OUT</b>}
            </span>
          </>
        }
      />
      {/* The score is the strongest thing in the row and also the second way
          into the stat line behind it: a thumb aiming at a 24px face on a
          moving bus will find this instead. */}
      <button
        type="button"
        className="sb__vs-pts"
        data-static={!box || undefined}
        aria-expanded={box ? shown : undefined}
        aria-label={box
          ? `${shown ? "Hide" : "Show"} ${p.full_name}'s stat line`
          : `${p.full_name}: ${fmt1(p.points)} points`}
        onClick={box ? () => toggle(p.player_id) : undefined}
        disabled={!box}
      >
        <b className="num">{fmt1(p.points)}</b>
        {p.projection != null && <span className="num">{fmt1(p.projection)}</span>}
      </button>
    </div>
  );
}

/**
 * "J. Taylor", not "Jonathan Taylor" cut off mid-word — a row this narrow
 * needs the same trick a stadium scoreboard uses, first initial and the
 * surname that actually identifies him. Defenses keep their own name; "NE"
 * off a scoreboard reads as the opponent, not the guy on your bench.
 */
function vsDisplayName(p: ScoreStarter): string {
  if (p.position === "DST") return p.full_name;
  const parts = p.full_name.trim().split(/\s+/);
  return parts.length < 2 ? p.full_name : `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}
