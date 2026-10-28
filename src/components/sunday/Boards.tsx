"use client";

/**
 * The rest of the board: the close games lifted out of it, every table as a
 * scorecard, and the NFL slate read against our rosters.
 */

import { Seal } from "@/components/ui";
import { TeamLogo } from "@/components/nfl";
import { crestUrl } from "@/lib/crest";
import { cardState, fmt1, kickLabel, projectedFinal, who, type ScoreCard, type Scoreboard as Board } from "@/lib/scoreboard";
import {
  isLate, lastName, leagueInGame, margin, sideCounts, slateOrder,
  type NflGame, type Phase,
} from "@/lib/sunday";
import { LiveScore, StateTag } from "./bits";
import { leagueCount } from "@/lib/gameday";

/* ---------------------------------------------------------- close games -- */

export function CloseGames({ cards, onOpen }: { cards: ScoreCard[]; onOpen: (id: string) => void }) {
  if (cards.length === 0) return null;
  return (
    <section className="sun-sec" data-panel="close" aria-label="Close games">
      <div className="sun-sec__head"><h2><i className="sun-dot" aria-hidden /> Close game{cards.length > 1 ? "s" : ""}</h2></div>
      <div className="sun-close">
        {cards.map((c) => {
          const [a, b] = Number(c.home.points) >= Number(c.away.points) ? [c.home, c.away] : [c.away, c.home];
          const left = (s: typeof a) => s.starters.filter((p) => !p.final).map((p) => lastName(p.full_name));
          return (
            <button key={c.id} type="button" className="sun-close__card" onClick={() => onOpen(c.id)}>
              <span className="sun-close__tag"><i className="sun-dot" aria-hidden /> Close game</span>
              <span className="sun-close__row"><span>{who(a)}</span><span>{Number(a.points).toFixed(2)}</span></span>
              <span className="sun-close__row"><span>{who(b)}</span><span>{Number(b.points).toFixed(2)}</span></span>
              <span className="sun-close__diff">Difference {Math.abs(margin(c)).toFixed(2)}</span>
              <span className="sun-close__left">
                {who(a)} — {left(a).join(", ") || "done"} · {who(b)} — {left(b).join(", ") || "done"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ the board -- */

export function AllMatchups({ board, focusId, close, phase, onOpen }: {
  board: Board; focusId: string | null; close: Set<string>; phase: Phase; onOpen: (id: string) => void;
}) {
  return (
    <section className="sun-sec" data-panel="matchups" aria-label="All league matchups">
      <div className="sun-sec__head">
        <h2>All league matchups</h2>
        <span>{board.matchups.length} tables · week {board.week}</span>
      </div>
      {board.matchups.length === 0
        ? <div className="sun-quiet">No matchups for week {board.week} yet. The schedule posts after the draft.</div>
        : (
          <div className="sun-cards">
            {board.matchups.map((c) => (
              <MatchupCard key={c.id} c={c} focus={c.id === focusId} close={close.has(c.id)} phase={phase} onOpen={onOpen} />
            ))}
          </div>
        )}
    </section>
  );
}

function MatchupCard({ c, focus, close, phase, onOpen }: {
  c: ScoreCard; focus: boolean; close: boolean; phase: Phase; onOpen: (id: string) => void;
}) {
  const state = cardState(c);
  const pre = state === "pre";
  const m = margin(c);
  const lead = (k: "home" | "away") => (pre ? undefined : m === 0 ? undefined : k === "home" ? m > 0 : m < 0);
  return (
    <button
      type="button" className="sun-card" data-focus={focus} data-mine={c.mine} data-close={close}
      onClick={() => onOpen(c.id)} aria-label={`${who(c.away)} versus ${who(c.home)}`}
    >
      <span className="sun-card__top">
        <StateTag state={state} late={isLate(c)} />
        {c.mine && <span className="sun-state" style={{ color: "var(--sun-gold)" }}>Yours</span>}
      </span>
      {(["away", "home"] as const).map((k) => {
        const s = k === "home" ? c.home : c.away;
        const n = sideCounts(s);
        return (
          <span key={k} className="sun-card__row" data-lead={lead(k)}>
            <span className="sun-card__who">
              <Seal name={s.name} src={crestUrl(s.logo_path)} mine={s.mine} size={22} />
              <span>{who(s)}</span>
            </span>
            {pre
              ? <span className="sun-card__pts" style={{ color: "var(--sun-muted)" }}>{fmt1(s.proj)}</span>
              : <LiveScore value={Number(s.points)} className="sun-card__pts" />}
            <span className="sun-card__meta" style={{ gridColumn: "1 / -1" }}>
              <span>{pre ? "projected" : `proj ${fmt1(projectedFinal(s))}`}</span>
              {phase !== "pre" || n.done > 0
                ? <span>{n.on > 0 && <em>{n.on} on · </em>}{n.toCome + n.on} left</span>
                : <span>{s.starters.length} to play</span>}
            </span>
          </span>
        );
      })}
    </button>
  );
}

/* ------------------------------------------------------------------ nfl -- */

export function NflBoard({ board, nfl, now, openId, onToggle }: {
  board: Board; nfl: NflGame[]; now: number; openId: string | null; onToggle: (id: string) => void;
}) {
  // Live games first, and among them the ones driving the most of our
  // scoring; then the rest of the slate in its own order.
  const rank = new Map(nfl.map((g) => [g.id, leagueCount(board, g).total]));
  const games = slateOrder(nfl).sort((a, b) =>
    (a.status === "in" && b.status === "in") ? (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0) : 0);
  const on = nfl.filter((g) => g.status === "in").length;
  const slateKnown = (board.games?.total ?? 0) > 0;
  return (
    <section className="sun-sec" data-panel="nfl" aria-label="NFL games">
      <div className="sun-sec__head">
        <h2>{on > 0 && <i className="sun-dot" aria-hidden />}NFL games</h2>
        <span>{on > 0 ? `${on} on now · ` : ""}tap a game for the Steakhouse players in it</span>
      </div>
      {games.length === 0
        ? (
          <div className="sun-quiet">
            {slateKnown
              ? "NFL scores aren't coming through right now. Fantasy scores above are unaffected and keep updating."
              : "No NFL games on file for this week."}
          </div>
        )
        : (
          <div className="sun-nfl">
            {games.map((g) => (
              <GameCard key={g.id} g={g} board={board} now={now} open={g.id === openId} onToggle={() => onToggle(g.id)} />
            ))}
          </div>
        )}
    </section>
  );
}

function GameCard({ g, board, now, open, onToggle }: {
  g: NflGame; board: Board; now: number; open: boolean; onToggle: () => void;
}) {
  const ours = leagueInGame(board, g);
  const pre = !g.status || g.status === "pre";
  const hs = g.home_score ?? 0, as = g.away_score ?? 0;
  const status = g.status === "in"
    ? g.detail ?? "Live"
    : g.status === "post" ? g.detail ?? "Final" : kickLabel(g.kickoff_at, now);
  const team = (abbr: string | null, score: number | null, lead: boolean | undefined) => (
    <span className="sun-game__team" data-lead={lead}>
      <TeamLogo abbr={abbr} size={20} />
      <span>
        {abbr ?? "—"}
        {g.status === "in" && g.possession === abbr && <span className="sun-ball" aria-label="has the ball"> 🏈</span>}
      </span>
      <span>{pre ? "" : score ?? 0}</span>
    </span>
  );
  return (
    <div id={`sun-game-${g.id}`} className="sun-game" data-open={open} data-rz={g.status === "in" && g.red_zone}>
      <button type="button" className="sun-game__head" onClick={onToggle} aria-expanded={open}
        aria-label={`${g.away} at ${g.home}${ours.length ? `, ${ours.length} of our players` : ""}`}>
        <span className="sun-game__teams">
          {team(g.away, g.away_score, pre ? undefined : as >= hs)}
          {team(g.home, g.home_score, pre ? undefined : hs >= as)}
        </span>
      </button>
      <span className="sun-game__status" data-state={g.status ?? "pre"}>
        <span>{status}</span>
        <span>
          {ours.length === 0 ? "No Steakhouse players"
            : `${ours.length} Steakhouse player${ours.length === 1 ? "" : "s"}`}
        </span>
      </span>
      {g.status === "in" && g.red_zone && (
        <span className="sun-game__rz">🔴 Red zone · {g.possession}{g.down_distance ? ` · ${g.down_distance}` : ""}</span>
      )}
      {g.status === "in" && !g.red_zone && g.down_distance && (
        <span className="sun-game__status"><span>{g.down_distance}</span></span>
      )}
      {open && (
        <div className="sun-game__ours">
          <h3>{g.away} @ {g.home} — fantasy players involved</h3>
          {ours.length === 0
            ? <span className="sun-game__p"><span>Nobody in the league is starting anyone in this one.</span></span>
            : ours.map((x) => (
              <span key={`${x.card.id}-${x.p.player_id}`} className="sun-game__p" data-mine={x.side.mine}>
                <span>{x.p.full_name} <small style={{ color: "var(--sun-dim)" }}>{x.p.position} · {x.p.nfl_team}</small></span>
                <i>{who(x.side)}</i>
                <b>{x.p.game_status === "pre" ? `${fmt1(x.p.projection)}p` : fmt1(x.p.points)}</b>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
