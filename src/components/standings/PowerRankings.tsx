"use client";

/**
 * The power rankings, under the table they disagree with.
 *
 * Deliberately on the standings page rather than at a nav entry of its own.
 * The rankings are only interesting next to the table — the whole content of
 * the feature is the gap between the two orders — and the bar had four
 * destinations folded out of it last week for exactly this reason.
 *
 * Pure function of the outlook payload, like `StandingsBoard`, so
 * `/preview/standings` renders it from an invented season with no session.
 */

import { useMemo } from "react";
import { ArrowDown, ArrowUp, Minus, TrendingUp } from "lucide-react";
import type { Outlook } from "@/lib/types";
import {
  canRank, ordinal, powerHeadline, powerLine, powerRankings, tablePositions,
  RECENT_WEEKS, RECENT_WEIGHT, SEASON_WEIGHT,
} from "@/lib/power";
import { Seal, SkeletonRows } from "@/components/ui";

export function PowerRankings({ outlook, myTeamId, crestOf }: {
  outlook: Outlook | null;
  myTeamId?: string | null;
  crestOf?: (teamId: string) => string | null;
}) {
  const rows = useMemo(() => (outlook && canRank(outlook) ? powerRankings(outlook) : null), [outlook]);
  const positions = useMemo(() => (outlook ? tablePositions(outlook) : new Map<string, number>()), [outlook]);
  const headline = useMemo(() => (rows ? powerHeadline(rows, positions) : null), [rows, positions]);

  if (!outlook) {
    return (
      <div className="card" style={{ marginTop: "var(--s5)" }}>
        <div className="card__head"><h2>Power rankings</h2></div>
        <SkeletonRows n={6} />
      </div>
    );
  }

  // Nothing has been played. There is no all-play record to take the schedule
  // out of, and ranking twelve teams on nothing is what the playoff odds
  // refuse to do one card above this.
  if (!rows) {
    return (
      <div className="card" style={{ marginTop: "var(--s5)" }}>
        <div className="card__head">
          <h2>Power rankings</h2>
          <TrendingUp size={17} color="var(--gold)" />
        </div>
        <div className="empty">
          Nothing has been played.<br />
          The rankings score every team against the whole league each week, so
          they start after week one.
        </div>
      </div>
    );
  }

  const weeks = rows[0]?.weeks ?? 0;

  return (
    <div className="card" style={{ marginTop: "var(--s5)" }}>
      <div className="card__head">
        <div>
          <h2>Power rankings</h2>
          <div className="eyebrow" style={{ marginTop: 5 }}>
            The table with the schedule taken out
          </div>
        </div>
        <TrendingUp size={17} color="var(--gold)" />
      </div>

      <div className="note" data-kind="info">
        Every week, every team&apos;s score against all eleven others — {weeks === 1
          ? "one week so far"
          : `${weeks} weeks so far`}, which is {weeks * 11} results apiece instead of {weeks}.
        Nothing here depends on who you were scheduled against. The order weights
        the season at {Math.round(SEASON_WEIGHT * 100)}% and the last {RECENT_WEEKS} weeks
        at {Math.round(RECENT_WEIGHT * 100)}%.
      </div>

      {headline && <p className="pwr__headline">{headline}</p>}

      <ol className="pwr">
        {rows.map((r) => {
          const mine = r.team_id === myTeamId;
          const pos = positions.get(r.team_id);
          return (
            <li key={r.team_id} className="pwr__row" data-mine={mine}>
              <span className="pwr__rank num" aria-hidden>{r.rank}</span>
              <Move move={r.move} />
              <Seal name={r.name} src={crestOf?.(r.team_id) ?? null} mine={mine} size={30} />
              <div className="pwr__who">
                <div className="pwr__name">
                  {r.name}
                  {pos && (
                    <span className="pwr__pos">
                      {ordinal(pos)} in the table
                    </span>
                  )}
                </div>
                <p className="pwr__line">{powerLine(r, mine)}</p>
              </div>
              {/* Both numbers the order is made of. Showing only the season
                  all-play would leave a row ranked fifth on a better record
                  than the row above it, with the explanation two paragraphs
                  away — which reads as a bug and is indistinguishable from
                  one. */}
              <div className="pwr__num">
                <b className="num">{r.ap_wins}-{r.ap_losses}{r.ap_ties ? `-${r.ap_ties}` : ""}</b>
                <span className="eyebrow">all-play</span>
                {r.recent_weeks < r.weeks && (
                  <>
                    <b className="num pwr__recent">
                      {r.recent_wins}-{r.recent_losses}{r.recent_ties ? `-${r.recent_ties}` : ""}
                    </b>
                    <span className="eyebrow">last {r.recent_weeks}</span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="card__body" style={{ paddingTop: "var(--s3)" }}>
        <span className="eyebrow" style={{ color: "var(--faint)" }}>
          Movement is against last week&apos;s rankings, recomputed rather than
          remembered — a corrected score fixes the arrows behind it.
        </span>
      </div>
    </div>
  );
}

/**
 * An arrow, with the number in its label rather than only in its colour. A
 * green triangle on its own is not a claim anybody can read out loud.
 */
function Move({ move }: { move: number | null }) {
  if (move === null) {
    return <span className="pwr__move" data-dir="none" aria-label="No ranking last week"><Minus size={13} /></span>;
  }
  if (move === 0) {
    return <span className="pwr__move" data-dir="flat" aria-label="Unchanged"><Minus size={13} /></span>;
  }
  const up = move > 0;
  return (
    <span className="pwr__move" data-dir={up ? "up" : "down"}
          aria-label={`${up ? "Up" : "Down"} ${Math.abs(move)} ${Math.abs(move) === 1 ? "place" : "places"}`}>
      {up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      <b className="num">{Math.abs(move)}</b>
    </span>
  );
}
