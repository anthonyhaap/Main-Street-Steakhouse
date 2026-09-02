"use client";

/**
 * The week's matchups, and what each lineup is doing inside them.
 *
 * Split out of `/matchups` so it can be rendered from a fixture. Every other
 * screen in the app already had that — `/preview/team`, `/preview/player`,
 * `/preview/draft`, `/preview/standings` — and the scoreboard did not, because
 * its markup lived inside the component that fetched its own data. There was
 * no way to look at it without a session, a completed draft and a live week,
 * which is to say: no way to look at it at all until the one afternoon it
 * matters.
 *
 * Presentational only. It takes rows and callbacks and owns nothing but which
 * card is expanded.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PlayerBadge } from "@/components/PlayerBadge";
import { Seal, fmtPts, useCountUp } from "@/components/ui";
import type { Matchup, RosterPoint, Team } from "@/lib/types";

export type ScoreboardProps = {
  matchups: Matchup[];
  points: RosterPoint[];
  teams: Team[];
  /** The viewer's team, so their game can be picked out. Null when unlinked. */
  myTeamId?: string | null;
};

export function Scoreboard({ matchups, points, teams, myTeamId = null }: ScoreboardProps) {
  const [open, setOpen] = useState<string | null>(null);

  const nameOf = (id: string) => teams.find((t) => t.id === id)?.name ?? "—";
  const managerOf = (id: string) => teams.find((t) => t.id === id)?.manager_name ?? null;
  const startersFor = (id: string) => points.filter((r) => r.team_id === id && r.slot !== "BN");

  return (
    <>
      {matchups.map((m) => {
        const isOpen = open === m.id;
        const mine = m.home_team_id === myTeamId || m.away_team_id === myTeamId;
        const hp = Number(m.home_points), ap = Number(m.away_points);
        return (
          <article key={m.id} className="card" data-accent={mine ? "gold" : undefined}>
            <button
              onClick={() => setOpen(isOpen ? null : m.id)}
              aria-expanded={isOpen}
              style={{
                display: "flex", alignItems: "center", gap: "var(--s4)", width: "100%",
                padding: "var(--s4) var(--s5)", background: "none", border: 0,
                color: "inherit", font: "inherit", cursor: "pointer", textAlign: "left",
              }}
            >
              {isOpen ? <ChevronDown size={16} color="var(--dim)" /> : <ChevronRight size={16} color="var(--dim)" />}
              <div style={{ flex: 1, display: "grid", gap: "var(--s2)", minWidth: 0 }}>
                <Side name={nameOf(m.away_team_id)} manager={managerOf(m.away_team_id)} pts={ap} win={ap > hp} mine={m.away_team_id === myTeamId} />
                <Side name={nameOf(m.home_team_id)} manager={managerOf(m.home_team_id)} pts={hp} win={hp > ap} mine={m.home_team_id === myTeamId} />
              </div>
            </button>

            {isOpen && (
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%,260px), 1fr))",
                gap: 1, background: "var(--rule)", borderTop: "1px solid var(--rule)",
              }}>
                {[m.away_team_id, m.home_team_id].map((tid) => {
                  const list = startersFor(tid);
                  return (
                    <div key={tid} style={{ background: "var(--ink-1)", padding: "var(--s3) 0" }}>
                      <div className="eyebrow" style={{ padding: "0 var(--s4) var(--s2)" }}>{nameOf(tid)}</div>
                      {list.length === 0 && (
                        <div className="empty" style={{ padding: "var(--s5)", fontSize: "var(--t-small)" }}>No lineup set.</div>
                      )}
                      {list.map((r) => (
                        <div key={r.player_id} style={{ display: "flex", gap: "var(--s2)", alignItems: "center", padding: "6px var(--s4)" }}>
                          <span className="pos" data-p={r.slot} style={{ minWidth: 38, height: 18, fontSize: 9 }}>{r.slot}</span>
                          {/* Was a bare string here — the only name in the app that
                              was not a badge, on the screen people watch live. */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <PlayerBadge
                              id={r.player_id}
                              name={r.full_name}
                              position={r.position}
                              team={r.nfl_team}
                              espnId={r.espn_id}
                              size={26}
                            />
                          </div>
                          <span className="num" style={{ fontSize: "var(--t-small)" }}>{fmtPts(r.points)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}

function Side({ name, manager, pts, win, mine }: {
  name: string; manager: string | null; pts: number; win: boolean; mine: boolean;
}) {
  const shown = useCountUp(pts);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", minWidth: 0 }}>
        <Seal name={name} mine={mine} size={26} />
        <span style={{ minWidth: 0, display: "grid" }}>
          <span style={{
            fontSize: "var(--t-head)", fontWeight: win ? 600 : 400,
            color: win ? "var(--cream)" : "var(--muted)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{name}</span>
          {manager && (
            <span style={{ fontSize: "var(--t-micro)", color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {manager}
            </span>
          )}
        </span>
      </div>
      <span className="score" style={{ fontSize: "1.45rem", color: win ? "var(--gold)" : "var(--muted)" }}>
        {shown.toFixed(1)}
      </span>
    </div>
  );
}
