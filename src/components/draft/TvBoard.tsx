"use client";

/**
 * The draft, on the television in the corner.
 *
 * Everything else in the draft room is built for a phone held by somebody who
 * is about to pick. This is built for the other eleven people, across a room,
 * with a drink in their hand and no intention of touching it. So: nothing to
 * tap, nothing that scrolls, four things on screen, and type sized so the
 * clock is legible from the sofa.
 *
 * It says the things a room shouts about — who is on the clock, how long they
 * have left, what just went, and whether it was a steal — and nothing it would
 * need a mouse to explore. The pick grades are the same `gradePick` the pool
 * and the ticker already use, so the television and the phone in your hand
 * never disagree about whether that was a reach.
 *
 * Pure, so /preview/draft-tv can run a whole draft past it with no session and
 * an e2e test can hold it still.
 */

import { fmtClock, gradePick, marketRankOf, pickLabel, teamAtPick } from "@/lib/draft";
import type { BoardPick, Draft, PoolPlayer, Team } from "@/lib/types";

export type TvState = {
  draft: Draft;
  picks: BoardPick[];
  teams: Team[];
};

export function TvBoard({ state, msLeft, poolById }: {
  state: TvState;
  /** Server-clock milliseconds left on the current pick; null when stopped. */
  msLeft: number | null;
  /** For grades. Absent simply means no grade is claimed. */
  poolById?: Map<string, PoolPlayer>;
}) {
  const { draft, picks, teams } = state;
  const teamCount = teams.length || 12;
  const total = teamCount * draft.rounds;
  const done = draft.status === "complete" || draft.current_pick > total;
  const started = draft.status !== "setup";

  const onClock = teamAtPick(draft.current_pick, teams, teamCount);
  const last = picks[picks.length - 1] ?? null;
  const lastGrade = last ? gradePick(last.pick_number, marketRankOf(poolById?.get(last.player_id))) : null;

  // Four names is what fits without shrinking the type to phone size.
  const upNext = [1, 2, 3, 4]
    .map((n) => ({ pick: draft.current_pick + n, team: teamAtPick(draft.current_pick + n, teams, teamCount) }))
    .filter((x) => x.team && x.pick <= total);

  const urgent = msLeft !== null && msLeft <= 15000 && msLeft > 0;
  const expired = msLeft !== null && msLeft <= 0;

  return (
    <div className="tv" data-urgent={urgent} data-done={done}>
      <header className="tv__head">
        <span className="tv__league">Main Street Steakhouse</span>
        <span className="tv__where">
          {!started ? "The draft has not started"
            : done ? "The board is full"
            : `Round ${Math.ceil(draft.current_pick / teamCount)} · Pick ${draft.current_pick} of ${total}`}
        </span>
      </header>

      <div className="tv__grid">
        {/* ------------------------------------------------ on the clock -- */}
        <section className="tv__clock" aria-label="On the clock">
          {done ? (
            <>
              <span className="tv__label">That&apos;s the draft</span>
              <b className="tv__team">Every seat is full.</b>
            </>
          ) : !started ? (
            <>
              <span className="tv__label">Standing by</span>
              <b className="tv__team">Waiting for the commissioner.</b>
            </>
          ) : (
            <>
              <span className="tv__label">On the clock</span>
              <b className="tv__team">{onClock?.name ?? "—"}</b>
              {onClock?.manager_name && <span className="tv__mgr">{onClock.manager_name}</span>}
              <span className="tv__time num" data-expired={expired}>
                {msLeft === null
                  ? draft.status === "paused" ? "PAUSED" : "—"
                  : expired ? "0:00" : fmtClock(msLeft)}
              </span>
            </>
          )}
        </section>

        {/* -------------------------------------------------- just went -- */}
        <section className="tv__last" aria-label="The last pick">
          <span className="tv__label">
            {last ? `Just picked · ${pickLabel(last.pick_number, teamCount)}` : "No picks yet"}
          </span>
          {last ? (
            <>
              <b className="tv__player">{last.player_name}</b>
              <span className="tv__meta">
                <i data-pos={last.position.toLowerCase()}>{last.position}</i>
                {last.nfl_team && <span>{last.nfl_team}</span>}
                <span className="tv__to">to {last.team_name}</span>
              </span>
              {/* Only when the room would have reacted. "On plan" on a
                  television is a caption nobody looks up for. */}
              {lastGrade && lastGrade.label !== "On plan" && (
                <span className="tv__grade" data-tone={lastGrade.tone}>
                  {lastGrade.label}
                  <em>
                    {lastGrade.delta > 0
                      ? `${lastGrade.delta} picks later than the market`
                      : `${Math.abs(lastGrade.delta)} picks earlier than the market`}
                  </em>
                </span>
              )}
            </>
          ) : (
            <b className="tv__player tv__player--quiet">The board is clean.</b>
          )}
        </section>

        {/* ---------------------------------------------------- up next -- */}
        <section className="tv__next" aria-label="Up next">
          <span className="tv__label">Up next</span>
          {upNext.length === 0 ? (
            <span className="tv__none">Nobody — that is the last pick.</span>
          ) : (
            <ol>
              {upNext.map(({ pick, team }) => (
                <li key={pick}>
                  <span className="num">{pickLabel(pick, teamCount)}</span>
                  <b>{team!.name}</b>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ----------------------------------------------- the last few -- */}
        <section className="tv__recent" aria-label="Recent picks">
          <span className="tv__label">Before that</span>
          {picks.length < 2 ? (
            <span className="tv__none">Nothing yet.</span>
          ) : (
            <ol>
              {picks.slice(-6, -1).reverse().map((p) => (
                <li key={p.pick_number}>
                  <span className="num">{pickLabel(p.pick_number, teamCount)}</span>
                  <b>{p.player_name}</b>
                  <i data-pos={p.position.toLowerCase()}>{p.position}</i>
                  <span className="tv__to">{p.team_name}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
