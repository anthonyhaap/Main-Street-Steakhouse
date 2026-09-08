"use client";

/**
 * The whole league at once, while it is happening.
 *
 * A tab on the scoreboard rather than a destination of its own: it is the same
 * Sunday, read the other way round, and it is only ever wanted while the board
 * is what you are already looking at.
 *
 * Pure — the page hands it the board it already fetched — so /preview/matchups
 * runs it through every stage of a Sunday with no session.
 */

import Link from "next/link";
import { Flame, TrendingDown, TrendingUp } from "lucide-react";
import { NflImage } from "@/components/nfl";
import { headshot, teamColor } from "@/lib/nfl/assets";
import { fmtPts } from "@/components/ui";
import {
  CLOSE_MARGIN, closeGames, houseLine, onNow, swings, who,
  type LivePlayer,
} from "@/lib/around";
// `who` here names a fantasy side; `who` from around.ts names the manager
// behind a player. Two different questions, so the import is renamed rather
// than one of them being bent to cover both.
import { who as sideName, type Scoreboard } from "@/lib/scoreboard";

export function AroundTheHouse({ board }: { board: Scoreboard }) {
  const live = onNow(board);
  const close = closeGames(board);
  const moved = swings(board);

  return (
    <div className="house-live">
      <p className="house-live__line">{houseLine(board)}</p>

      {/* ------------------------------------------------------- on now -- */}
      <section className="card">
        <div className="card__head">
          <div>
            <h2>On the field</h2>
            <div className="eyebrow" style={{ marginTop: 5 }}>
              Every starter in the league whose game is on, best first
            </div>
          </div>
          <Flame size={17} color="var(--gold)" />
        </div>

        {live.length === 0 ? (
          <div className="empty">
            Nobody is playing right now.<br />
            This fills up the moment the next window kicks off.
          </div>
        ) : (
          <ol className="hl">
            {live.map((p) => <LiveRow key={`${p.team_id}:${p.starter.player_id}`} p={p} />)}
          </ol>
        )}
      </section>

      {/* ------------------------------------------------------- closest -- */}
      <section className="card" style={{ marginTop: "var(--s5)" }}>
        <div className="card__head">
          <div>
            <h2>Worth watching</h2>
            <div className="eyebrow" style={{ marginTop: 5 }}>
              Live games inside {CLOSE_MARGIN} points, closest first
            </div>
          </div>
        </div>

        {close.length === 0 ? (
          <div className="empty">
            Nothing close.<br />
            Every game still going is a comfortable one.
          </div>
        ) : (
          <ul className="hl-close">
            {close.map(({ card, margin, left, on }) => {
              const [up, down] = Number(card.home.points) >= Number(card.away.points)
                ? [card.home, card.away] : [card.away, card.home];
              return (
                <li key={card.id} data-mine={card.mine}>
                  <Link href={`/matchups?week=${board.week}`} className="hl-close__names">
                    <b>{sideName(up)}</b>
                    <span className="num">{fmtPts(up.points)}</span>
                    <i>—</i>
                    <span className="num">{fmtPts(down.points)}</span>
                    <b>{sideName(down)}</b>
                  </Link>
                  <span className="hl-close__gap num">
                    {margin === 0 ? "level" : `${fmtPts(margin)} in it`}
                  </span>
                  <span className="hl-close__left">
                    {on > 0 && `${on} on now`}
                    {on > 0 && left > 0 && " · "}
                    {left > 0 && `${left} still to play`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- swings -- */}
      {moved.length > 0 && (
        <section className="card" style={{ marginTop: "var(--s5)" }}>
          <div className="card__head">
            <div>
              <h2>Days made and ruined</h2>
              <div className="eyebrow" style={{ marginTop: 5 }}>
                Finished games only — a man on nine at half time has not busted
              </div>
            </div>
          </div>
          <ol className="hl">
            {moved.map((p) => <LiveRow key={`${p.team_id}:${p.starter.player_id}`} p={p} swing />)}
          </ol>
        </section>
      )}
    </div>
  );
}

function LiveRow({ p, swing = false }: { p: LivePlayer; swing?: boolean }) {
  const s = p.starter;
  const color = teamColor(s.nfl_team);
  const delta = p.vs_projection;

  return (
    <li className="hl__row" data-mine={p.mine}>
      <NflImage
        src={headshot(s.espn_id)}
        alt={s.full_name}
        size={34}
        fit={s.position === "DST" ? "contain" : "cover"}
        background={color ? `${color}1f` : "var(--ink-2)"}
      />
      <div className="hl__who">
        <div className="hl__name">
          {s.full_name}
          <i data-pos={s.position.toLowerCase()}>{s.position}</i>
        </div>
        <div className="hl__sub">
          {/* Whose afternoon he is deciding — the reason this list is not just
              a list of good performances. */}
          <span>{p.mine ? "yours" : who(p)}</span>
          {s.game_detail && <span className="hl__game">{s.game_detail}</span>}
        </div>
      </div>

      <div className="hl__num">
        <b className="num">{fmtPts(s.points)}</b>
        {swing && delta !== null && (
          <span className="hl__delta" data-up={delta > 0}>
            {delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {delta > 0 ? "+" : ""}{fmtPts(delta)}
          </span>
        )}
        {!swing && (
          <span className="hl__margin" data-up={p.margin >= 0}>
            {p.margin >= 0 ? "up " : "down "}{fmtPts(Math.abs(p.margin))}
          </span>
        )}
      </div>
    </li>
  );
}
