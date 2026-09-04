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

import { useState } from "react";
import { ChevronDown, ChevronRight, Flame, TriangleAlert } from "lucide-react";
import { PlayerBadge } from "@/components/PlayerBadge";
import { crestUrl } from "@/lib/crest";
import { Seal, useCountUp } from "@/components/ui";
import {
  cardLine, cardState, gameMark, hasProblem, kickLabel, pctLabel, projectedFinal,
  stillToPlay, topPerformer, versusProjection, winOdds, fmt1,
  type ScoreCard, type ScoreSide, type ScoreStarter, type Scoreboard as Board,
  type WinOdds,
} from "@/lib/scoreboard";

export function Scoreboard({ board, now }: { board: Board; now: number }) {
  const mine = board.matchups.find((m) => m.mine) ?? null;
  const rest = board.matchups.filter((m) => m !== mine);

  return (
    <>
      {mine && <Card key={mine.id} c={mine} now={now} myTeamId={board.my_team_id} hero />}
      {rest.length > 0 && (
        <section className="sb-rest" aria-label="The rest of the league">
          <div className="room__head">
            <span className="eyebrow">{mine ? "Around the room" : `Week ${board.week}`}</span>
            <span className="eyebrow">{rest.length} table{rest.length === 1 ? "" : "s"}</span>
          </div>
          <div className="sb-list">
            {rest.map((c) => (
              <Card key={c.id} c={c} now={now} myTeamId={board.my_team_id} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ card -- */

function Card({ c, now, myTeamId, hero = false }: {
  c: ScoreCard; now: number; myTeamId: string | null; hero?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const state = cardState(c);
  const odds = winOdds(c);
  // Before the draft there are two teams, no lineups and nothing to model.
  // An odds bar reading 50–50 over that is the standings' preseason mistake
  // in a different shape.
  const lineups = c.home.starters.length + c.away.starters.length > 0;
  const hp = Number(c.home.points), ap = Number(c.away.points);
  // Before anyone kicks, the projection is the only ranking there is.
  const lead = state === "pre"
    ? { home: c.home.proj > c.away.proj, away: c.away.proj > c.home.proj }
    : { home: hp > ap, away: ap > hp };

  return (
    <article className="sb" data-hero={hero} data-mine={c.mine} data-state={state}>
      <header className="sb__top">
        <StateChip state={state} c={c} now={now} />
        {hero && c.mine && <span className="eyebrow" data-tone="gold">Your table</span>}
      </header>

      <div className="sb__sides">
        <Side s={c.away} lead={lead.away} hero={hero} state={state} lineups={lineups} />
        <span className="sb__vs" aria-hidden>vs</span>
        <Side s={c.home} lead={lead.home} hero={hero} state={state} lineups={lineups} />
      </div>

      {lineups && <Odds c={c} odds={odds} state={state} />}

      <p className="sb__line">{cardLine(c, myTeamId)}</p>

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

      {open && (
        <div className="sb__lineups">
          {[c.away, c.home].map((s) => (
            <div className="sb__lineup" key={s.team_id}>
              <div className="sb__lineup-head">
                <span className="eyebrow">{s.name}</span>
                <span className="num sb__lineup-tot">{fmt1(s.points)}</span>
              </div>
              {s.starters.length === 0 && <div className="empty">No lineup set.</div>}
              {s.starters.map((p) => <PlayerRow key={p.player_id} p={p} now={now} />)}
            </div>
          ))}
        </div>
      )}
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
function Odds({ c, odds, state }: { c: ScoreCard; odds: WinOdds; state: string }) {
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

function StateChip({ state, c, now }: { state: string; c: ScoreCard; now: number }) {
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

function PlayerRow({ p, now }: { p: ScoreStarter; now: number }) {
  const mark = gameMark(p, now);
  return (
    <div className="sb__plr" data-final={p.final} data-bye={p.on_bye}>
      <span className="pos" data-p={p.slot}>{p.slot}</span>
      <div className="sb__plr-who">
        <PlayerBadge
          id={p.player_id}
          name={p.full_name}
          position={p.position}
          team={p.nfl_team}
          espnId={p.espn_id}
          size={26}
        />
        <span className="sb__mark" data-state={mark.state}>
          {mark.state === "live" && <i className="sb__pip" aria-hidden />}
          {mark.label}
          {p.severity === "out" && <b className="sb__hurt"> · OUT</b>}
        </span>
      </div>
      <span className="sb__plr-pts">
        <b className="num">{fmt1(p.points)}</b>
        <span className="num">{p.projection == null ? "—" : fmt1(p.projection)}</span>
      </span>
    </div>
  );
}
