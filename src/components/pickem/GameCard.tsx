"use client";

import { Check, ChevronDown, Lock, X } from "lucide-react";
import { TeamLogo } from "@/components/nfl";
import { team as clubOf } from "@/lib/nfl/teams";
import type { PickemGame } from "@/lib/pickem/types";
import { PickDistribution } from "@/components/pickem/PickDistribution";

const WHEN = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;

function fmtKickoff(iso: string | null) {
  if (!iso) return "Kickoff TBD";
  return new Date(iso).toLocaleString(undefined, WHEN);
}

/**
 * One matchup, in the four states the request calls out: needing a pick,
 * picked, locked/live, and final — each meant to carry visibly less weight
 * than the last, so what's left to pick is always the easiest thing to find.
 */
export function GameCard({
  game, members, busy, onPick,
}: {
  game: PickemGame;
  members: number;
  busy: boolean;
  onPick: (team: string) => void;
}) {
  const final = game.status === "post";
  const phase: "open" | "picked" | "locked" | "final" =
    final ? "final" : game.locked ? "locked" : game.my_pick ? "picked" : "open";
  const canPick = phase === "open" || phase === "picked";
  const noPick = game.locked && !game.my_pick;
  const outcome = final
    ? game.winner === null ? "push" : game.my_pick === game.winner ? "correct" : "wrong"
    : null;

  const teamBlock = (abbr: string, score: number | null) => {
    const club = clubOf(abbr);
    const mine = game.my_pick === abbr;
    const won = final && game.winner === abbr;
    return (
      <button
        type="button"
        className="pickem-team"
        data-mine={mine}
        data-final={final || undefined}
        data-won={won || undefined}
        disabled={!canPick || busy}
        onClick={() => canPick && onPick(abbr)}
      >
        <TeamLogo abbr={abbr} size={40} />
        <span className="pickem-team__abbr">{club?.abbr ?? abbr}</span>
        {final && score !== null && <span className="pickem-team__score num">{score}</span>}
        {mine && <Check className="pickem-team__check" size={13} strokeWidth={3} aria-label="Your pick" />}
      </button>
    );
  };

  return (
    <article className="card pickem-card" data-phase={phase}>
      <div className="pickem-card__head">
        <span className="eyebrow">{final || game.locked ? game.status_detail ?? fmtKickoff(game.kickoff_at) : fmtKickoff(game.kickoff_at)}</span>
        {phase === "locked" && (
          <span className="badge" data-tone={noPick ? "danger" : "live"}>
            <Lock size={11} /> {noPick ? "No pick" : "Locked"}
          </span>
        )}
        {final && outcome === "correct" && <span className="badge" data-tone="ok"><Check size={11} /> Correct</span>}
        {final && outcome === "wrong" && <span className="badge" data-tone="danger"><X size={11} /> {game.my_pick ? "Wrong" : "No pick"}</span>}
        {final && outcome === "push" && <span className="badge" data-tone="neutral">Tie</span>}
      </div>

      <div className="card__body pickem-card__body">
        <div className="pickem-matchup">
          {teamBlock(game.away_team, game.away_score)}
          <span className="pickem-at">@</span>
          {teamBlock(game.home_team, game.home_score)}
        </div>

        {game.distribution && (
          <PickDistribution
            distribution={game.distribution}
            members={members}
            awayTeam={game.away_team}
            homeTeam={game.home_team}
          />
        )}

        {game.picks && game.picks.length > 0 && (
          <details className="pickem-picks">
            <summary className="pickem-picks__toggle">
              <span>See everyone&apos;s picks</span>
              <ChevronDown className="pickem-picks__chevron" size={14} aria-hidden />
            </summary>
            <ul className="pickem-picks__list">
              {game.picks.map((p) => (
                <li key={p.user_id}>
                  <span>{p.display_name}</span>
                  <span className="pickem-picks__team">{p.selected_team ?? "No pick"}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
