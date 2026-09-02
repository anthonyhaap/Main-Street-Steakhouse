"use client";

import { NflImage } from "@/components/nfl";
import { headshot, teamColor } from "@/lib/nfl/assets";
import type { BoardPick, Draft, Team } from "@/lib/types";
import { snakeSlot } from "@/lib/draft";

type Props = {
  draft: Draft;
  teams: Team[];
  picks: BoardPick[];
  myTeamId: string | null;
};

export function Board({ draft, teams, picks, myTeamId }: Props) {
  const teamCount = teams.length || 12;
  const byPick = new Map(picks.map((p) => [p.pick_number, p]));
  const rounds = Array.from({ length: draft.rounds }, (_, i) => i + 1);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="card__head">
        <h2>The board</h2>
        <span className="eyebrow">
          <span className="num">{picks.length}</span> of <span className="num">{teamCount * draft.rounds}</span>
        </span>
      </div>

      <div className="scroll" style={{ padding: "var(--s3)", minHeight: 0 }}>
        <div style={{ minWidth: teamCount * 108, display: "grid", gap: 3 }}>

          <div style={{ display: "grid", gridTemplateColumns: `30px repeat(${teamCount}, 1fr)`, gap: 3, position: "sticky", top: 0, zIndex: 2, background: "var(--ink-1)", paddingBottom: 3 }}>
            <div />
            {teams.map((t) => (
              <div key={t.id} className="eyebrow" title={t.name}
                style={{
                  padding: "5px 3px", textAlign: "center",
                  color: t.id === myTeamId ? "var(--gold)" : "var(--dim)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  letterSpacing: "0.1em",
                }}>
                {t.name}
              </div>
            ))}
          </div>

          {rounds.map((round) => (
            <div key={round} style={{ display: "grid", gridTemplateColumns: `30px repeat(${teamCount}, 1fr)`, gap: 3 }}>
              <div className="eyebrow num" style={{ display: "grid", placeItems: "center" }}>{round}</div>

              {Array.from({ length: teamCount }, (_, i) => {
                const slot = i + 1;
                const base = (round - 1) * teamCount;
                let pickNo = base + 1;
                for (let k = 1; k <= teamCount; k++) {
                  if (snakeSlot(base + k, teamCount) === slot) { pickNo = base + k; break; }
                }
                const pick = byPick.get(pickNo);
                const isCurrent = pickNo === draft.current_pick && draft.status !== "complete";
                const isMine = teams[i]?.id === myTeamId;

                return (
                  <div key={slot}
                    title={pick ? `${pick.player_name} — ${pick.team_name}` : `Pick ${pickNo}`}
                    style={{
                      minHeight: 44, padding: "5px 6px", borderRadius: 6, overflow: "hidden",
                      background: pick ? "#ffffff" : isCurrent ? "var(--gold-wash)" : "var(--ink-2)",
                      border: `1px solid ${isCurrent ? "var(--gold)" : isMine ? "var(--gold-lit)" : "transparent"}`,
                      borderLeft: pick ? `2px solid var(--${pick.position.toLowerCase()})` : undefined,
                      transition: "background 0.2s var(--ease)",
                    }}>
                    {pick ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                          <NflImage
                            src={headshot(pick.espn_id)}
                            alt={pick.player_name}
                            size={20}
                            fit={pick.position === "DST" ? "contain" : "cover"}
                            background={teamColor(pick.nfl_team)
                              ? `${teamColor(pick.nfl_team)}1f` : "var(--ink-2)"}
                          />
                          <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {pick.player_name}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 3, fontSize: 9, color: "var(--dim)" }}>
                          <span style={{ color: `var(--${pick.position.toLowerCase()})`, fontWeight: 600 }}>{pick.position}</span>
                          <span>{pick.nfl_team ?? ""}</span>
                          {pick.is_autopick && <span title="Autopicked" style={{ marginLeft: "auto" }}>auto</span>}
                        </div>
                      </>
                    ) : (
                      <div className="num" style={{ fontSize: 10, color: isCurrent ? "var(--gold)" : "var(--faint)" }}>
                        {pickNo}
                      </div>
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
