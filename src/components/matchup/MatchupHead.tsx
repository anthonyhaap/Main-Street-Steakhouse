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
 * It has no collapsed twin. It used to hand off to a sticky scoreline on
 * scroll; the pager above it is sticky and carries the same two numbers
 * permanently, so the handoff was two bars saying one thing. Both read
 * `leader()`, so the gilded name cannot differ between them.
 */

import { Seal, useCountUp } from "@/components/ui";
import { Odds, StateChip } from "@/components/Scoreboard";
import { crestUrl } from "@/lib/crest";
import {
  cardState, fmt1, hasProblem, leader, projectedFinal, remainingProjection,
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
