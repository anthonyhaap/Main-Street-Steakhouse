"use client";

import { useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { Standing } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { Seal, SkeletonRows, fmtPts } from "@/components/ui";

export default function StandingsPage() {
  const { ready, team, league } = useSession();

  const fetcher = useCallback(async () => {
    const { data } = await supabaseBrowser().from("standings").select("*").eq("league_id", LEAGUE_ID);
    return (data ?? []) as Standing[];
  }, []);

  const { data, status } = useLive<Standing[]>(fetcher, {
    tables: ["matchups", "teams"], channel: "standings", pollMs: 60000, enabled: ready,
  });

  const playoffTeams = Number((league?.settings as { playoff_teams?: number })?.playoff_teams ?? 6);
  const rows = [...(data ?? [])].sort((a, b) => b.wins - a.wins || Number(b.points_for) - Number(a.points_for));
  const played = rows.some((r) => r.wins + r.losses + r.ties > 0);

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="narrow">
        <div className="card">
          <div className="card__head">
            <h2>Standings</h2>
            <span className="eyebrow">Top {playoffTeams} make the playoffs</span>
          </div>

          {!data && <SkeletonRows n={12} />}

          {data && !played && (
            <div className="empty">Nothing settled yet.<br />Standings fill in once week 1 kicks off.</div>
          )}

          {data && played && (
            <div className="scroll" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 540 }}>
                <thead>
                  <tr>
                    {["", "Team", "W", "L", "T", "PF", "PA", "Diff"].map((h) => (
                      <th key={h} className="eyebrow" scope="col"
                        style={{
                          textAlign: h === "Team" ? "left" : "right",
                          padding: "var(--s3) var(--s4)",
                          borderBottom: "1px solid var(--rule)", whiteSpace: "nowrap",
                        }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => {
                    const diff = Number(s.points_for) - Number(s.points_against);
                    const cutoff = i + 1 === playoffTeams;
                    return (
                      <tr key={s.team_id} style={{
                        background: s.team_id === team?.id ? "var(--gold-haze)" : undefined,
                        borderBottom: cutoff ? "1px solid var(--gold-dim)" : "1px solid var(--rule-soft)",
                      }}>
                        <td className="num eyebrow" style={{ padding: "var(--s3) var(--s4)" }}>{i + 1}</td>
                        <td style={{ padding: "var(--s3) var(--s4)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                            <Seal name={s.name} mine={s.team_id === team?.id} size={26} />
                            <span style={{ whiteSpace: "nowrap" }}>{s.name}</span>
                          </div>
                        </td>
                        <td className="num" style={cell}>{s.wins}</td>
                        <td className="num" style={cell}>{s.losses}</td>
                        <td className="num" style={{ ...cell, color: "var(--dim)" }}>{s.ties}</td>
                        <td className="num" style={cell}>{fmtPts(s.points_for)}</td>
                        <td className="num" style={{ ...cell, color: "var(--muted)" }}>{fmtPts(s.points_against)}</td>
                        <td className="num" style={{ ...cell, color: diff >= 0 ? "var(--win)" : "var(--lose)" }}>
                          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

const cell: React.CSSProperties = { padding: "var(--s3) var(--s4)", textAlign: "right", whiteSpace: "nowrap" };
