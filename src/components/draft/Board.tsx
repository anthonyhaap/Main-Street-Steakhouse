"use client";

import { useEffect, useRef } from "react";
import { NflImage } from "@/components/nfl";
import { headshot, teamColor } from "@/lib/nfl/assets";
import type { BoardPick, Draft, PoolPlayer, Team } from "@/lib/types";
import { gradePick, marketRankOf, roundForPick, snakeSlot } from "@/lib/draft";

const GRADE_COLOR: Record<string, string> = {
  ok: "var(--win)", warn: "var(--warn)", danger: "var(--lose)", neutral: "var(--dim)",
};

/**
 * A board cell is one twelfth of a phone's width. "Ja'Marr Chase" truncates to
 * "Ja'Marr C…" there and tells you nothing; the surname alone fits and is what
 * a draft board has always printed. A defense keeps its full name — "Ravens
 * D/ST" is the name.
 */
const shortName = (name: string, position: string) => {
  if (position === "DST") return name;
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
};

type Props = {
  draft: Draft;
  teams: Team[];
  picks: BoardPick[];
  myTeamId: string | null;
  /** ADP / overall rank lookup, so each pick can be graded against the market. */
  poolById?: Map<string, PoolPlayer>;
  /** Open a drafted player's card in place. */
  onOpen?: (playerId: string) => void;
};

export function Board({ draft, teams, picks, myTeamId, poolById, onOpen }: Props) {
  const teamCount = teams.length || 12;
  const byPick = new Map(picks.map((p) => [p.pick_number, p]));
  const rounds = Array.from({ length: draft.rounds }, (_, i) => i + 1);
  const round = roundForPick(draft.current_pick, teamCount);

  // Fifteen rounds is a long grid, and by round six the live pick is below the
  // fold with no way to know it. Follow the clock down the board instead —
  // wherever you have scrolled to, a new pick brings the room back with it.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = scroller.current?.querySelector<HTMLElement>('[data-round="' + round + '"]');
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [round]);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="card__head">
        <h2>The board</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s4)" }}>
          {poolById && picks.length > 0 && (
            <span className="eyebrow hide-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}
              title="A dot marks a pick graded well off its ADP">
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--win)", display: "inline-block" }} />
              value
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--lose)", display: "inline-block" }} />
              reach
            </span>
          )}
          <span className="eyebrow">
            <span className="num">{picks.length}</span> of <span className="num">{teamCount * draft.rounds}</span>
          </span>
        </div>
      </div>

      <div className="scroll board__scroll" ref={scroller}>
        <div className="board__inner board__grid" style={{ "--board-cols": teamCount } as React.CSSProperties}>

          <div className="board__row board__head">
            <div />
            {teams.map((t) => (
              <div key={t.id} className="eyebrow board__team" data-mine={t.id === myTeamId} title={t.name}>
                {t.name}
              </div>
            ))}
          </div>

          {rounds.map((r) => (
            <div key={r} className="board__row" data-round={r}>
              <div className="eyebrow num" style={{ display: "grid", placeItems: "center" }}>{r}</div>

              {Array.from({ length: teamCount }, (_, i) => {
                const slot = i + 1;
                const base = (r - 1) * teamCount;
                let pickNo = base + 1;
                for (let k = 1; k <= teamCount; k++) {
                  if (snakeSlot(base + k, teamCount) === slot) { pickNo = base + k; break; }
                }
                const pick = byPick.get(pickNo);
                const isCurrent = pickNo === draft.current_pick && draft.status !== "complete";
                const isMine = teams[i]?.id === myTeamId;
                const grade = pick ? gradePick(pickNo, marketRankOf(poolById?.get(pick.player_id))) : null;
                const notable = grade && grade.label !== "On plan" ? grade : null;
                const clickable = !!pick && !!onOpen;
                const club = pick ? teamColor(pick.nfl_team) : null;

                return (
                  <div key={slot}
                    className="board__cell"
                    data-filled={!!pick}
                    data-current={isCurrent || undefined}
                    data-mine={isMine || undefined}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onOpen(pick.player_id) : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(pick.player_id); } } : undefined}
                    title={pick
                      ? `${pick.player_name} — ${pick.team_name}${notable ? ` · ${notable.label} (${notable.delta > 0 ? "+" : ""}${notable.delta} vs ADP)` : ""}`
                      : `Pick ${pickNo}`}
                    style={pick ? { borderLeft: `2px solid var(--${pick.position.toLowerCase()})` } : undefined}>
                    {pick ? (
                      <>
                        {notable && (
                          <span aria-hidden className="board__grade" style={{ background: GRADE_COLOR[notable.tone] }} />
                        )}
                        <div className="board__player">
                          <NflImage
                            src={headshot(pick.espn_id)}
                            alt={pick.player_name}
                            size={24}
                            fit={pick.position === "DST" ? "contain" : "cover"}
                            background={club ? `${club}1f` : "var(--ink-2)"}
                          />
                          <span className="board__pname">{shortName(pick.player_name, pick.position)}</span>
                        </div>
                        <div className="board__pmeta">
                          <span style={{ color: `var(--${pick.position.toLowerCase()})`, fontWeight: 600 }}>{pick.position}</span>
                          <span>{pick.nfl_team ?? ""}</span>
                          {pick.is_autopick && <span title="Autopicked" style={{ marginLeft: "auto" }}>auto</span>}
                        </div>
                      </>
                    ) : (
                      <div className="num board__empty">{isCurrent ? "on the clock" : pickNo}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
