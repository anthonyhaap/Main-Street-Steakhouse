"use client";

/**
 * The matchup, at the top of its own screen.
 *
 * The question this answers in two seconds and nothing else on the page does:
 * who is playing, what the score is, where it is going, who is winning, and
 * how much football either side has left. Everything below it is detail.
 *
 * Deliberately not a `.sb` card. The card on the list page is one of six and
 * has to hold a sentence, a record, a thread and a share button; this is the
 * only thing at the top of a screen, so it spends its height on two names and
 * two numbers and gives the rest to the lineup. The odds bar and the state
 * chip are imported from the card rather than restated, because a win
 * probability drawn two ways is a win probability a league will catch
 * disagreeing with itself.
 *
 * `MatchupSticky` is the same header with everything but the scoreline taken
 * out, for the bar that replaces it once the reader has scrolled into the
 * lineup. Both read `leader()`, so the gilded name cannot differ between them.
 */

import { useEffect, useState } from "react";
import { Seal, useCountUp } from "@/components/ui";
import { Odds, StateChip } from "@/components/Scoreboard";
import { crestUrl } from "@/lib/crest";
import {
  abbr, cardState, fmt1, hasProblem, leader, projectedFinal, remainingProjection, stateWord,
  winOdds, type ScoreCard, type ScoreSide,
} from "@/lib/scoreboard";
import { TriangleAlert } from "lucide-react";

export function MatchupHead({ c, now }: { c: ScoreCard; now: number }) {
  const state = cardState(c);
  const ahead = leader(c);
  // Before the draft there are two teams, no lineups and nothing to model. An
  // odds bar reading 50-50 over that is a lie with a gradient on it.
  const lineups = c.home.starters.length + c.away.starters.length > 0;

  return (
    <section className="mhead" data-state={state} aria-label="Matchup scoreboard">
      <div className="mhead__chip">
        <StateChip state={state} c={c} now={now} />
        {c.mine && <span className="eyebrow" data-tone="gold">Your table</span>}
      </div>

      <div className="mhead__grid">
        <HeadSide s={c.away} lead={ahead === "away"} state={state} lineups={lineups} />
        <span className="mhead__vs" aria-hidden>vs</span>
        <HeadSide s={c.home} lead={ahead === "home"} state={state} lineups={lineups} align="end" />
      </div>

      {lineups && <Odds c={c} odds={winOdds(c)} state={state} />}

      {/* The one line that says whether the game is actually still a game. */}
      {lineups && (
        <div className="mhead__left">
          <Left s={c.away} />
          <span className="mhead__left-mid">
            {c.away.in_action + c.home.in_action > 0
              ? `${c.away.in_action + c.home.in_action} on now`
              : "nobody on"}
          </span>
          <Left s={c.home} align="end" />
        </div>
      )}
    </section>
  );
}

function HeadSide({ s, lead, state, lineups, align = "start" }: {
  s: ScoreSide; lead: boolean; state: string; lineups: boolean; align?: "start" | "end";
}) {
  const shown = useCountUp(Number(s.points));
  const problem = hasProblem(s);

  return (
    <div className="mhead__side" data-lead={lead} data-align={align} data-mine={s.mine}>
      <Seal name={s.name} src={crestUrl(s.logo_path)} mine={s.mine} size={34} />
      <b className="mhead__name">{s.name}</b>
      <span className="mhead__who">
        {s.manager_name?.trim() || "—"}
        <i>{s.wins}–{s.losses}{s.ties ? `–${s.ties}` : ""}</i>
      </span>
      <b className="mhead__pts num">
        {/* No roster is not a projection of nothing; it is no projection. */}
        {!lineups ? "—" : state === "pre" ? fmt1(s.proj) : shown.toFixed(1)}
      </b>
      <span className="mhead__proj num">
        {!lineups ? "" : state === "pre" ? "projected"
          // Nobody left to play: the score is the projection, and printing it
          // twice only invites the question of why they differ.
          : s.yet_to_play === 0 ? "final"
          : `proj. ${fmt1(projectedFinal(s))}`}
      </span>
      {problem && (
        <span className="mhead__flag">
          <TriangleAlert size={11} />
          {s.empty_slots > 0
            ? `${s.empty_slots} empty slot${s.empty_slots === 1 ? "" : "s"}`
            : "lineup problem"}
        </span>
      )}
    </div>
  );
}

/** "3 left · 41.2 to come" — how much of this side's week is unspent. */
function Left({ s, align = "start" }: { s: ScoreSide; align?: "start" | "end" }) {
  const left = s.yet_to_play;
  return (
    <span className="mhead__left-side" data-align={align}>
      <b className="num">{left}</b>
      {left === 1 ? "player left" : "players left"}
      {left > 0 && <i className="num">{fmt1(remainingProjection(s))} to come</i>}
    </span>
  );
}

/* ---------------------------------------------------------------- sticky -- */

/**
 * The scoreline, and nothing else, for once the header has scrolled away.
 *
 * `useScrolledPast` watches a sentinel under the header rather than the header
 * itself: an element's own intersection is measured against the viewport, and
 * the viewport here has a 68px top bar and a matchup rail parked on top of it,
 * so "not intersecting" happens well after the header is actually hidden
 * behind them.
 */
export function MatchupSticky({ c, on }: { c: ScoreCard; on: boolean }) {
  const state = cardState(c);
  const ahead = leader(c);
  const pre = state === "pre";

  return (
    <div className="mstick" data-on={on} aria-hidden={!on}>
      <StickSide s={c.away} value={pre ? c.away.proj : c.away.points} lead={ahead === "away"} />
      <span className="mstick__state">
        {state === "live" && <i className="sb__pip" aria-hidden />}
        {stateWord(state)}
      </span>
      <StickSide s={c.home} value={pre ? c.home.proj : c.home.points} lead={ahead === "home"} align="end" />
    </div>
  );
}

function StickSide({ s, value, lead, align = "start" }: {
  s: ScoreSide; value: number; lead: boolean; align?: "start" | "end";
}) {
  return (
    <span className="mstick__side" data-lead={lead} data-align={align}>
      <b>{abbr(s.name)}</b>
      <span className="num">{fmt1(value)}</span>
    </span>
  );
}

/**
 * True once the watched element has gone past `offset` pixels from the top of
 * the viewport — the line the top bar and the matchup rail sit on.
 *
 * An IntersectionObserver with a negative top root margin rather than a scroll
 * listener: the same answer, off the compositor, without a handler running on
 * every frame of a flick through nine lineup rows.
 *
 * It hands back a callback ref rather than taking a `useRef`, because the
 * element it watches does not exist on the first render: the live page has no
 * sentinel to hang it on until `ff_scoreboard` has answered. A ref object's
 * identity never changes, so an effect keyed on one would run once against a
 * null element and never again — and the bar would simply never appear on the
 * one screen it was written for. A callback ref is state, so the effect runs
 * when the element actually arrives.
 */
export function useScrolledPast(offset: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [past, setPast] = useState(false);

  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    // `boundingClientRect.top` as well as `isIntersecting`: an element below
    // the fold is also not intersecting, and a bar that appears before you
    // have scrolled to the thing it replaces is worse than no bar.
    const io = new IntersectionObserver(
      ([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < offset),
      { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, offset]);

  return { ref: setEl, past };
}
