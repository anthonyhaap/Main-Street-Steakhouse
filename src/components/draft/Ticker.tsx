"use client";

import { useEffect, useRef } from "react";
import { NflImage } from "@/components/nfl";
import { headshot, teamColor } from "@/lib/nfl/assets";
import { gradePick, marketRankOf, pickLabel } from "@/lib/draft";
import type { BoardPick, PoolPlayer, Reaction } from "@/lib/types";
import { PickReactions } from "@/components/draft/PickReactions";

const GRADE_COLOR: Record<string, string> = {
  ok: "var(--win)", warn: "var(--warn)", danger: "var(--lose)", neutral: "var(--dim)",
};

/**
 * The last dozen picks, newest first, as a strip you can swipe.
 *
 * On a phone the board is a separate tab, so the moment you open the player
 * list you lose all sight of what the room is doing — and "what just went off
 * the board" is the single thing you check most during a draft. Toasts said it
 * once and vanished; this says it for as long as it matters, in the order it
 * happened, with the grade attached and a tap through to the card.
 */
export function Ticker({
  picks, poolById, myTeamId, teamCount, onOpen,
  reactionsFor, onReact, reacting = null,
}: {
  picks: BoardPick[];
  poolById?: Map<string, PoolPlayer>;
  myTeamId: string | null;
  teamCount: number;
  onOpen?: (playerId: string) => void;
  /** Tallies for one pick. Absent means no reactions are drawn at all. */
  reactionsFor?: (pickId: string) => Reaction[];
  onReact?: (pickId: string, emoji: string) => void;
  /** The pick whose write is in flight, so its row stops taking presses. */
  reacting?: string | null;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const last = picks[picks.length - 1]?.pick_number ?? 0;

  // A new pick lands at the left edge; snap back there so the newest is the
  // one you see, however far you had swiped into the history.
  useEffect(() => {
    strip.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [last]);

  const recent = picks.slice(-14).reverse();

  return (
    <div className="card" style={{ flexShrink: 0 }}>
      <div className="tick" ref={strip} aria-label="Recent picks">
        {recent.length === 0 ? (
          <span className="tick__empty">No picks yet — the board is clean.</span>
        ) : (
          recent.map((pick) => {
            const grade = gradePick(pick.pick_number, marketRankOf(poolById?.get(pick.player_id)));
            const notable = grade && grade.label !== "On plan" ? grade : null;
            const color = teamColor(pick.nfl_team);
            return (
              // A wrapper rather than one button: the reactions are buttons of
              // their own, and a button inside a button is markup no browser
              // agrees about.
              <div key={pick.pick_number} className="tick__item" data-mine={pick.team_id === myTeamId}>
              <button className="tick__open"
                onClick={onOpen ? () => onOpen(pick.player_id) : undefined}
                title={`${pick.player_name} — ${pick.team_name}${notable ? ` · ${notable.label}` : ""}`}>
                <NflImage
                  src={headshot(pick.espn_id)}
                  alt={pick.player_name}
                  size={30}
                  fit={pick.position === "DST" ? "contain" : "cover"}
                  background={color ? `${color}1f` : "var(--ink-2)"}
                />
                <span className="tick__text">
                  <span className="tick__name">{pick.player_name}</span>
                  <span className="tick__sub">
                    <span className="num">{pickLabel(pick.pick_number, teamCount)}</span>
                    <b style={{ color: `var(--${pick.position.toLowerCase()})` }}>{pick.position}</b>
                    <span className="tick__by">{pick.team_id === myTeamId ? "You" : pick.team_name}</span>
                    {pick.is_autopick && <span title="Autopicked">auto</span>}
                    {notable && (
                      <span className="tick__dot" style={{ background: GRADE_COLOR[notable.tone] }}
                        title={`${notable.label} · ${notable.delta > 0 ? "+" : ""}${notable.delta} vs ADP`} />
                    )}
                  </span>
                </span>
              </button>

              {/* Only when the page has wired the RPC; the fixture and any
                  read-only render simply do not pass it. */}
              {onReact && (
                <PickReactions
                  reactions={reactionsFor?.(pick.pick_id) ?? []}
                  busy={reacting === pick.pick_id}
                  onPress={(emoji) => onReact(pick.pick_id, emoji)}
                />
              )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
