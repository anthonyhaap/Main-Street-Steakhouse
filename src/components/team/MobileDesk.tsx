"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, Pencil } from "lucide-react";
import type { HubPlayer, TeamHub } from "@/lib/nfl/types";
import { Seal } from "@/components/ui";

/**
 * The top of the desk on a phone: who you are, how this week is going, and the
 * three places a manager goes from here — in about a third of the screen, so
 * the lineup starts above the fold.
 *
 * The wide desk keeps its hero (`.th-hero`), which has the room to lay both
 * teams side by side with six stats beneath them. On a phone that hero was
 * 560px tall before the first player, and the lineup — the reason the page
 * exists — started under the tab bar. These are drawn instead below 760px;
 * the stats the hero carried are one tap away on the matchup and the
 * standings, and the projection rides on the score card.
 *
 * Both are rendered and CSS chooses (`.m-only` / `.d-only`), rather than a
 * media query in JavaScript: the desk is prerendered, and a layout picked
 * after hydration would draw the wrong one first and then jump.
 */

/** Kicked off and not over. ESPN's status words, read the way `gameWhen` reads them. */
export function inProgress(p: HubPlayer): boolean {
  const s = p.game?.status;
  if (!s || /^(pre|scheduled|status_scheduled)/i.test(s)) return false;
  return !/final|post/i.test(s);
}

export function finished(p: HubPlayer): boolean {
  const s = p.game?.status;
  return !!s && /final|post/i.test(s);
}

/**
 * What this side will finish on if every projection is right from here — the
 * same number the matchup page prints as "proj." (`projectedFinal` in
 * `@/lib/scoreboard`), worked from the desk's own roster so the two screens
 * never disagree.
 *
 * Before anybody kicks off it is the plain pre-game total, as the matchup
 * page shows it. After that it is the points on the board plus what is still
 * to come: a starter whose game is over (or who has none) adds nothing more,
 * one mid-game adds whatever is left of his projection, and one yet to play
 * adds all of it.
 */
export function projectedFinal(points: number, starters: (HubPlayer | null)[], pregame: number): number {
  const on = starters.filter((p): p is HubPlayer => !!p);
  if (!on.some((p) => inProgress(p) || finished(p))) return pregame;
  const toCome = on.reduce((acc, p) => {
    if (!p.game || p.on_bye || finished(p)) return acc;
    const proj = Number(p.projection ?? 0);
    return acc + (inProgress(p) ? Math.max(0, proj - Number(p.points)) : proj);
  }, 0);
  return Math.round((points + toCome) * 10) / 10;
}

/** Starters still to score: not finished, not on bye, and not an empty slot. */
export function yetToPlay(starters: (HubPlayer | null)[]): number {
  return starters.filter((p) => p && p.game && !p.on_bye && !finished(p)).length;
}

export function DeskHeader({
  hub, crest, readOnly, picker, onEdit,
}: {
  hub: TeamHub;
  crest: string | null;
  readOnly: boolean;
  picker: ReactNode;
  onEdit?: () => void;
}) {
  const rec = hub.record;
  return (
    <header className="mt-head m-only">
      <div className="mt-head__eyebrow">
        <span>{hub.league.name}</span>
        {readOnly && (
          <span className="mt-head__visiting" title="Another manager's team — read only">
            <Eye size={11} aria-hidden /> Viewing
          </span>
        )}
        {onEdit && !readOnly && (
          <button type="button" className="mt-head__icon" onClick={onEdit} aria-label="Edit team name and crest">
            <Pencil size={14} aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-head__team">
        <Seal name={hub.team.name} src={crest} mine size={40} />
        <div className="mt-head__name">
          <h1>{hub.team.name}</h1>
          {rec && (
            <span className="mt-head__rec num">
              {rec.wins}–{rec.losses}{rec.ties ? `–${rec.ties}` : ""} · {ordinal(rec.rank)} of {rec.teams}
            </span>
          )}
        </div>
        {/* The league's other desks. The page's own select, laid invisibly
            over the chevron, so the phone's native picker is what opens. */}
        {picker && (
          <span className="mt-head__pick">
            <ChevronDown size={18} aria-hidden />
            {picker}
          </span>
        )}
      </div>
    </header>
  );
}

export function DeskScore({
  hub, mine, theirs, projected, starters, currentWeek, onWeek, oppCrest,
}: {
  hub: TeamHub;
  mine: number;
  theirs: number;
  projected: number;
  starters: (HubPlayer | null)[];
  currentWeek: number | null;
  onWeek: (w: number) => void;
  oppCrest: string | null;
}) {
  const m = hub.matchup;
  const live = starters.some((p) => p && inProgress(p));
  const started = starters.some((p) => p && (inProgress(p) || finished(p)));
  const left = yetToPlay(starters);
  // Only this side's starters are in hand, so "done" is about them: the
  // opponent may still have a man in a later game, and the card never calls
  // the matchup final on half the evidence.
  const done = started && left === 0;
  const state = live ? "live" : done ? "done" : started ? "between" : "pre";
  const total = mine + theirs;
  const share = total > 0 ? (mine / total) * 100 : 50;

  return (
    <section className="mt-score m-only" aria-label={`Week ${hub.week} matchup`}>
      <div className="mt-score__top">
        {/* The week is a native select: eighteen options is the phone's own
            picker's job, and it costs one line instead of a scrolling strip. */}
        <label className="mt-score__week" data-state={state}>
          {state === "live" && <i className="mt-score__dot" aria-hidden />}
          <span>Week {hub.week}{state === "live" ? " · Live" : ""}</span>
          <ChevronDown size={12} aria-hidden />
          <select
            aria-label="Week"
            value={hub.week}
            onChange={(e) => onWeek(Number(e.target.value))}
          >
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}{w === currentWeek ? " (this week)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="mt-score__proj">
          Projected <b className="num">{projected > 0 ? projected.toFixed(1) : "—"}</b>
        </span>
      </div>

      <Link
        href={m ? `/matchups/${m.id}` : "/matchups"}
        className="mt-score__board"
        aria-label={m ? `Open the matchup against ${m.opponent.name}` : "Open this week's matchups"}
      >
        <span className="mt-score__side">
          <span className="mt-score__who">You</span>
          <b className="num" data-lead={mine >= theirs}>{mine.toFixed(1)}</b>
        </span>
        <span className="mt-score__vs">vs</span>
        <span className="mt-score__side" data-align="end">
          <span className="mt-score__who">
            {m ? (
              <>
                <Seal name={m.opponent.name} src={oppCrest} size={18} />
                <span className="mt-score__opp">{m.opponent.name}</span>
              </>
            ) : "No opponent"}
          </span>
          <b className="num" data-lead={theirs > mine}>{m ? theirs.toFixed(1) : "—"}</b>
        </span>
        <ChevronRight size={16} className="mt-score__go" aria-hidden />
      </Link>

      <div className="mt-score__bar" aria-hidden>
        <i style={{ width: `${share}%` }} />
      </div>
      <div className="mt-score__foot">
        <span>
          {left > 0 && state === "pre"
            ? <><b className="num">{left}</b> {left === 1 ? "starter" : "starters"} yet to play</>
            : left > 0
              ? <><b className="num">{left}</b> {left === 1 ? "starter" : "starters"} yet to finish</>
              : "Your starters are done"}
        </span>
        {m && (
          <span>{m.home ? "Home" : "Away"}{m.opponent.record
            ? ` · they're ${m.opponent.record.wins}–${m.opponent.record.losses}${m.opponent.record.ties ? `–${m.opponent.record.ties}` : ""}`
            : ""}</span>
        )}
      </div>
    </section>
  );
}

/**
 * My Team / Matchup / Players. The first is this screen; the other two are the
 * pages a manager goes to from it — the full matchup, and the player pool —
 * so the strip is links, and the current one is marked rather than pressed.
 */
export function DeskTabs({ matchupId }: { matchupId: string | null }) {
  return (
    <nav className="mt-tabs m-only" aria-label="Team sections">
      <span className="mt-tabs__opt" data-on="true" aria-current="page">My Team</span>
      <Link className="mt-tabs__opt" href={matchupId ? `/matchups/${matchupId}` : "/matchups"}>Matchup</Link>
      <Link className="mt-tabs__opt" href="/transactions?tab=players">Players</Link>
    </nav>
  );
}

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};
