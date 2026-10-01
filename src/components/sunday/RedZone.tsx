"use client";

/**
 * The right-hand rail: Fantasy RedZone.
 *
 * Not every NFL play — the ones that matter to this league. Before kickoff
 * that is who to watch and which tables are close on paper; once football is
 * on it is who of ours is inside the twenty and which situations the board
 * has turned into; after the last game it is how the day finished.
 *
 * Alerts carry their level, and the level decides the weight: a final is a
 * line in the log, an upset brewing gets the brass edge and slides in, a game
 * inside a point with the clock running takes the red.
 */

import { Tv } from "lucide-react";
import { REDZONE_URL } from "@/lib/config";
import { fmt1, kickLabel, who, type ScoreCard, type Scoreboard as Board } from "@/lib/scoreboard";
import {
  closeOnPaper, inTheRedZone, playersToWatch, recap,
  type Alert, type Phase, type SundayBoard,
} from "@/lib/sunday";
import { EventFeed, type FeedActions } from "./Feed";

export function WatchRedZone({ compact = false }: { compact?: boolean }) {
  return (
    <a className="sun-btn" data-v="gold" href={REDZONE_URL} target="_blank" rel="noopener noreferrer"
      title="Opens the NFL's own page in a new tab">
      <Tv size={14} aria-hidden /> <span>{compact ? "RedZone" : "Watch NFL RedZone"}</span>
    </a>
  );
}

export function RedZoneRail({ board, phase, list, now, onMatchup, onGame, onReact, onTalk }: {
  board: SundayBoard; phase: Phase; list: Alert[]; now: number;
} & FeedActions) {
  const hasFeed = (board.events?.length ?? 0) + (board.activity?.length ?? 0) > 0;
  return (
    <section className="sun-sec" data-panel="redzone" aria-label="Fantasy RedZone" style={{ display: "grid", gap: "var(--s3)" }}>
      <div className="sun-sec__head">
        <h2>{phase === "live" && <i className="sun-dot" aria-hidden />}Fantasy RedZone</h2>
        <span>{phase === "pre" ? "before kickoff" : phase === "final" ? "the day's results" : "why it matters to us"}</span>
      </div>
      {phase === "pre"
        ? <PreGame board={board} now={now} onMatchup={onMatchup} />
        : <Live board={board} list={list} phase={phase} onMatchup={onMatchup} onGame={onGame} />}
      {/* What happened, as opposed to what is true right now. Kept through
          the final whistle and after it, so the day can be scrolled back. */}
      {hasFeed && (
        <EventFeed events={board.events ?? []} activity={board.activity ?? []} now={now}
          onMatchup={onMatchup} onGame={onGame} onReact={onReact} onTalk={onTalk} />
      )}
      <div className="sun-watch">
        <span>The broadcast is the NFL&apos;s. This is the second screen.</span>
        <WatchRedZone />
      </div>
    </section>
  );
}

function Live({ board, list, phase, onMatchup, onGame }: {
  board: SundayBoard; list: Alert[]; phase: Phase;
  onMatchup: (id: string) => void; onGame: (id: string) => void;
}) {
  const rz = inTheRedZone(board);
  // The red-zone box names every one of ours inside the twenty; the same
  // drives would only repeat themselves as alerts underneath it. Once the
  // event feed is running, the board's own situations are a short "right
  // now" strip above it — the league alerts only, three at most — rather
  // than a second feed saying what the first one already said.
  const hasFeed = (board.events?.length ?? 0) > 0;
  const rest = list
    .filter((a) => a.kind !== "red_zone")
    .filter((a) => !hasFeed || (a.level >= 3 && a.live))
    .slice(0, hasFeed ? 3 : undefined);
  return (
    <>
      {rz.length > 0 && (
        <div className="sun-rz" aria-label="Players in the red zone">
          <h3><i className="sun-dot" aria-hidden />{rz.length > 1 ? "Players in the red zone" : "In the red zone"}</h3>
          {rz.map((x) => (
            <button key={`${x.card.id}-${x.p.player_id}`} type="button" className="sun-rz__row" onClick={() => onMatchup(x.card.id)}>
              <b>{x.p.full_name}</b>
              <i>{who(x.side)}</i>
              <span>{x.game.possession} ball{x.game.down_distance ? ` — ${x.game.down_distance}` : ""}</span>
            </button>
          ))}
        </div>
      )}
      {hasFeed && rest.length > 0 && <div className="sun-sec__head" style={{ margin: 0 }}><h2>Right now</h2></div>}
      {!hasFeed && rest.length === 0 && rz.length === 0 && (
        <div className="sun-quiet">
          {phase === "final"
            ? "No results on the board yet."
            : "Quiet around the league. Nothing within a score late, nobody of ours inside the twenty."}
        </div>
      )}
      <div className="sun-feed" role="feed" aria-busy="false">
        {rest.map((a) => (
          <article key={a.id} className="sun-alert" data-level={a.level} data-kind={a.kind}>
            <span className="sun-alert__tag">
              {a.live && a.level >= 3 && <i className="sun-dot" aria-hidden />}
              {a.tag}
            </span>
            <span className="sun-alert__head">{a.headline}</span>
            {a.lines.map((l) => <span key={l} className="sun-alert__line">{l}</span>)}
            {a.level >= 2 && (a.matchupId || a.gameId) && (
              <span className="sun-alert__act">
                {a.matchupId && <button type="button" onClick={() => onMatchup(a.matchupId!)}>Open matchup</button>}
                {a.gameId && <button type="button" onClick={() => onGame(a.gameId!)}>NFL game</button>}
              </span>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function PreGame({ board, now, onMatchup }: { board: Board; now: number; onMatchup: (id: string) => void }) {
  const watch = playersToWatch(board);
  const close = closeOnPaper(board);
  return (
    <>
      <div>
        <div className="sun-sec__head"><h2>Players to watch</h2><span>highest projected</span></div>
        {watch.length === 0 ? <div className="sun-quiet">No lineups set yet.</div> : (
          <div className="sun-list">
            {watch.map((x) => (
              <button key={`${x.card.id}-${x.p.player_id}`} type="button" className="sun-list__row" onClick={() => onMatchup(x.card.id)}>
                <span>
                  <b>{x.p.full_name}</b> <small>{x.p.position} · {x.p.nfl_team} · {kickLabel(x.p.kickoff_at, now)} · {who(x.side)}</small>
                </span>
                <b>{fmt1(x.p.projection)}</b>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="sun-sec__head"><h2>Close on paper</h2><span>projected within 8</span></div>
        {close.length === 0 ? <div className="sun-quiet">No table is projected inside a score.</div> : (
          <div className="sun-list">
            {close.map((c) => <PaperRow key={c.id} c={c} onOpen={onMatchup} />)}
          </div>
        )}
      </div>
    </>
  );
}

function PaperRow({ c, onOpen }: { c: ScoreCard; onOpen: (id: string) => void }) {
  const gap = Math.abs(Number(c.home.proj) - Number(c.away.proj));
  return (
    <button type="button" className="sun-list__row" onClick={() => onOpen(c.id)}>
      <span>{who(c.away)} {fmt1(c.away.proj)} — {who(c.home)} {fmt1(c.home.proj)}</span>
      <b>{gap < 0.05 ? "even" : `±${fmt1(gap)}`}</b>
    </button>
  );
}

/* ---------------------------------------------------------------- recap -- */

export function Recap({ board, onMatchup }: { board: Board; onMatchup: (id: string) => void }) {
  const r = recap(board);
  const line = (c: ScoreCard) => {
    const [a, b] = Number(c.home.points) >= Number(c.away.points) ? [c.home, c.away] : [c.away, c.home];
    return `${who(a)} ${fmt1(a.points)} — ${who(b)} ${fmt1(b.points)}`;
  };
  const gap = (c: ScoreCard) => fmt1(Math.abs(Number(c.home.points) - Number(c.away.points)));
  const tiles: { title: string; big: string; small: string; id: string }[] = [];
  if (r.highest) tiles.push({ title: "Highest score", big: `${who(r.highest.side)} ${fmt1(r.highest.side.points)}`, small: r.highest.side.name, id: r.highest.card.id });
  if (r.closest) tiles.push({ title: "Closest game", big: line(r.closest), small: `Decided by ${gap(r.closest)}`, id: r.closest.id });
  if (r.blowout) tiles.push({ title: "Biggest blowout", big: line(r.blowout), small: `By ${gap(r.blowout)}`, id: r.blowout.id });
  if (r.upset) {
    const s = r.upset.key === "home" ? r.upset.card.home : r.upset.card.away;
    tiles.push({ title: "Biggest upset", big: `${who(s)} won`, small: `Came in projected ${fmt1(r.upset.gap)} behind · ${line(r.upset.card)}`, id: r.upset.card.id });
  }
  if (r.bestPlayer) tiles.push({ title: "Biggest fantasy day", big: `${r.bestPlayer.p.full_name} ${fmt1(r.bestPlayer.p.points)}`, small: `for ${who(r.bestPlayer.side)} · ${r.bestPlayer.p.position} ${r.bestPlayer.p.nfl_team ?? ""}`, id: r.bestPlayer.card.id });
  if (r.lowest) tiles.push({ title: "Lowest score", big: `${who(r.lowest.side)} ${fmt1(r.lowest.side.points)}`, small: r.lowest.side.name, id: r.lowest.card.id });

  return (
    <section className="sun-recap" data-panel="recap" aria-label="Sunday recap">
      <h2>🥩 Sunday at the Steakhouse</h2>
      {tiles.length === 0 ? <div className="sun-quiet">Nothing was played this week.</div> : (
        <div className="sun-tiles">
          {tiles.map((t) => (
            <button key={t.title} type="button" className="sun-tile" onClick={() => onMatchup(t.id)}>
              <h3>{t.title}</h3>
              <b>{t.big}</b>
              <span>{t.small}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
