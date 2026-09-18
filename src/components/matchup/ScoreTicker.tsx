"use client";

/**
 * The five other tables, run along the top of the page the way a stadium
 * scoreboard carries the rest of the day's games while you watch the one in
 * front of you. It never shows the game you're already looking at — that one
 * has the whole page — only the ones you'd otherwise have to scroll for.
 */

import { cardState, fmt1, type ScoreCard, type Scoreboard as Board } from "@/lib/scoreboard";

export function ScoreTicker({ board }: { board: Board }) {
  const others = board.matchups.filter((m) => !m.mine);
  if (others.length === 0) return null;

  return (
    <div className="ticker" aria-label={`The other ${others.length} tables this week`}>
      <div className="ticker__row">
        {others.map((c) => <TickerGame key={c.id} c={c} />)}
      </div>
    </div>
  );
}

function TickerGame({ c }: { c: ScoreCard }) {
  const state = cardState(c);
  const pre = state === "pre";
  const hp = Number(c.home.points), ap = Number(c.away.points);

  return (
    <div className="ticker__game" data-state={state}>
      <TickerSide s={c.away} value={pre ? c.away.proj : ap} lead={!pre && ap > hp} />
      <TickerSide s={c.home} value={pre ? c.home.proj : hp} lead={!pre && hp > ap} />
      <span className="ticker__state">
        {state === "live" && <i className="ticker__pip" aria-hidden />}
        {pre ? "proj." : state === "live" ? "live" : state === "settled" ? "final" : "—"}
      </span>
    </div>
  );
}

function TickerSide({ s, value, lead }: { s: ScoreCard["home"]; value: number; lead: boolean }) {
  return (
    <span className="ticker__team" data-lead={lead}>
      <b>{abbr(s.name)}</b>
      <span className="num">{fmt1(value)}</span>
    </span>
  );
}

/** "DAL", not "Dallas Cowboys" — a scoreboard has three characters per team. */
function abbr(name: string): string {
  return name.trim().slice(0, 3).toUpperCase();
}
