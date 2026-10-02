"use client";

/**
 * The game center, from the reader's chair.
 *
 *   MyMatchup      your table, the widest and loudest thing on the page
 *   MomentBox      the one thing worth saying about a table right now
 *   JustHappened   the last few moments that mattered, fantasy-first
 *   LeaguePulse    every other table, a line each
 *   NextUp         what the page says when nothing is on
 *
 * Pictures of `@/lib/gameday`, which does the deciding — so the preview, the
 * live page and the front page all say the same sentence about the same board.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Seal } from "@/components/ui";
import { crestUrl } from "@/lib/crest";
import { cardState, fmt1, pctLabel, projectedFinal, who, type ScoreSide } from "@/lib/scoreboard";
import type { Phase, SundayEvent } from "@/lib/sunday";
import {
  eventStory, leftOf, oddsFor, standingOf,
  type Moment, type NextUp as Next, type PulseItem, type Seat, type Standing,
} from "@/lib/gameday";
import { LiveScore } from "./bits";

const ago = (iso: string, now: number) => {
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

/* ------------------------------------------------------------ my matchup -- */

export function MyMatchup({ seat, moment, onNeed }: {
  seat: Seat; moment: Moment | null;
  /** Open the "What do I need?" panel, when there is one. */
  onNeed?: () => void;
}) {
  const { card, key, me, them } = seat;
  const state = cardState(card);
  const pre = state === "pre";
  const odds = oddsFor(card);
  const mine = standingOf(card, key);
  const theirs = standingOf(card, key === "home" ? "away" : "home");
  const pMe = odds ? (key === "home" ? odds.home : odds.away) : null;
  const stateWord = state === "live" ? "Live" : state === "settled" ? "Final" : state === "between" ? "In play" : "Projected";

  return (
    <section id="sun-mine" className="gd-mine" data-state={state} aria-label="My matchup">
      <div className="gd-mine__top">
        <span className="gd-eyebrow">My matchup</span>
        <span className="sun-state" data-state={state}>
          {state === "live" && <i className="sun-dot" aria-hidden />}
          {stateWord}
        </span>
      </div>
      <div className="gd-score">
        <MineSide s={me} st={mine} pct={pMe} align="start" pre={pre} settled={!!odds?.settled} />
        <span className="gd-score__dash" aria-hidden>—</span>
        <MineSide s={them} st={theirs} pct={pMe === null ? null : 100 - pMe} align="end" pre={pre} settled={!!odds?.settled} />
      </div>
      {odds && !odds.settled && (
        <div className="gd-odds" role="img"
          aria-label={`Win probability: ${who(me)} ${pctLabel(pMe!)}, ${who(them)} ${pctLabel(100 - pMe!)}`}>
          <span style={{ width: `${pMe}%` }} />
          <span style={{ width: `${100 - pMe!}%` }} />
        </div>
      )}
      {moment && <MomentBox m={moment} />}
      <div className="gd-mine__act">
        <Link className="sun-btn" href={`/matchups/${card.id}?week=${card.week}`}>
          {state === "live" ? "View live matchup" : "Full matchup"} <ArrowRight size={14} aria-hidden />
        </Link>
        {onNeed && state !== "pre" && state !== "settled" && (
          <button type="button" className="sun-btn" onClick={onNeed}>What do I need?</button>
        )}
      </div>
    </section>
  );
}

function MineSide({ s, st, pct, align, pre, settled }: {
  s: ScoreSide; st: Standing; pct: number | null; align: "start" | "end"; pre: boolean; settled: boolean;
}) {
  const n = leftOf(s);
  return (
    <div className="gd-side" data-align={align} data-tone={st.tone} data-mine={s.mine}>
      <span className="gd-side__id">
        <Seal name={s.name} src={crestUrl(s.logo_path)} mine={s.mine} size={28} />
        <span className="gd-side__names">
          <b>{who(s)}</b>
          <i>{s.name}</i>
        </span>
      </span>
      {pre
        ? <span className="gd-side__pts num">{fmt1(s.proj)}</span>
        : <LiveScore value={Number(s.points)} className="gd-side__pts num" />}
      <span className="gd-side__word">{st.word}{pct !== null && !settled ? <b> · {pctLabel(pct)}</b> : null}</span>
      <span className="gd-side__meta">
        {pre ? `${s.starters.length} to play` : <>Proj {fmt1(projectedFinal(s))}</>}
      </span>
      {!pre && (
        <span className="gd-side__meta">
          {n.left === 0 ? "Done" : `${n.left} remaining`}
          {n.live > 0 && <em> · {n.live} live</em>}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- moment -- */

export function MomentBox({ m, className = "gd-moment" }: { m: Moment; className?: string }) {
  return (
    <div className={className} data-tone={m.tone} role="status">
      <span className={`${className}__tag`}>{m.tag}</span>
      <b className={`${className}__title`}>{m.title}</b>
      {m.lines.map((l) => <span key={l} className={`${className}__line`}>{l}</span>)}
    </div>
  );
}

/* --------------------------------------------------------- what happened -- */

export function StoryCard({ e, now, onOpen }: { e: SundayEvent; now: number; onOpen?: (matchupId: string) => void }) {
  const s = eventStory(e);
  const body = (
    <>
      <span className="gd-story__tag">
        {s.tone === "hot" && <i className="sun-dot" aria-hidden />}
        {s.tag}
        <time dateTime={e.created_at}>{ago(e.created_at, now)}</time>
      </span>
      <b className="gd-story__title">{s.title}{s.sub && <small> — {s.sub}</small>}</b>
      {s.impact && <span className="gd-story__impact" data-neg={s.impact.neg}>{s.impact.text}</span>}
      {s.line && <span className="gd-story__line">{s.line}</span>}
    </>
  );
  return onOpen && e.matchup_id
    ? <button type="button" className="gd-story" data-tone={s.tone} data-kind={e.type} onClick={() => onOpen(e.matchup_id!)}>{body}</button>
    : <article className="gd-story" data-tone={s.tone} data-kind={e.type}>{body}</article>;
}

export function JustHappened({ events, now, phase, onOpen }: {
  events: SundayEvent[]; now: number; phase: Phase; onOpen: (matchupId: string) => void;
}) {
  if (phase === "pre") return null;
  return (
    <section className="sun-sec gd-happened" data-panel="happened" aria-label="What just happened">
      <div className="sun-sec__head">
        <h2>{phase === "live" && <i className="sun-dot" aria-hidden />}What just happened</h2>
        <span>last 45 minutes</span>
      </div>
      {events.length === 0
        ? <div className="sun-quiet">Nothing big in the last 45 minutes. Touchdowns, lead changes and swings land here the minute they happen.</div>
        : <div className="gd-stories">{events.map((e) => <StoryCard key={e.id} e={e} now={now} onOpen={onOpen} />)}</div>}
    </section>
  );
}

/* ----------------------------------------------------------- league pulse -- */

export function LeaguePulse({ items, phase, onOpen, compact = false }: {
  items: PulseItem[]; phase: Phase; onOpen?: (matchupId: string) => void; compact?: boolean;
}) {
  if (phase === "pre") return null;
  return (
    <section className="sun-sec gd-pulse" data-panel="pulse" data-compact={compact} aria-label="League pulse">
      <div className="sun-sec__head">
        <h2>League pulse</h2>
        <span>every table, right now</span>
      </div>
      {items.length === 0
        ? <div className="sun-quiet">Quiet across the league. No lead changes, nothing within five.</div>
        : (
          <ul className="gd-pulse__list">
            {items.map((p) => (
              <li key={p.id} data-kind={p.kind} data-mine={p.mine}>
                {onOpen && p.matchupId ? (
                  <button type="button" onClick={() => onOpen(p.matchupId!)}>
                    <span aria-hidden>{p.emoji}</span><span>{p.text}</span>
                  </button>
                ) : (
                  <span className="gd-pulse__row"><span aria-hidden>{p.emoji}</span><span>{p.text}</span></span>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/* ---------------------------------------------------------------- next up -- */

/** When nothing is on: the real next kickoff off the slate, never a guess. */
export function NextUp({ next, phase, betweenWindows }: { next: Next | null; phase: Phase; betweenWindows: boolean }) {
  if (phase === "final") return null;
  if (phase === "live" && !betweenWindows) return null;
  const g = next?.game;
  return (
    <section className="gd-next" aria-label="Next kickoff">
      <b>{betweenWindows ? "Between windows." : "No games are live right now."}</b>
      {next ? (
        <>
          <span>The board starts moving at <strong>{next.label}</strong>.</span>
          <span className="gd-next__game">
            Next up: {g!.away} @ {g!.home}
            {next.ours > 0 && ` · ${next.ours} Steakhouse player${next.ours === 1 ? "" : "s"}`}
          </span>
        </>
      ) : (
        <span>No more kickoffs on the slate this week.</span>
      )}
    </section>
  );
}
