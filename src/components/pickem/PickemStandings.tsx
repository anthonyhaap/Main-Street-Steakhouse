"use client";

import { useMemo } from "react";
import { ArrowDown, ArrowUp, Minus, Trophy } from "lucide-react";
import { SkeletonRows } from "@/components/ui";
import type { PickemSeasonStanding, PickemWeeklyStanding } from "@/lib/pickem/types";

const cell: React.CSSProperties = { padding: "var(--s3) var(--s4)" };

function Movement({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="eyebrow" style={{ color: "var(--faint)" }}>NEW</span>;
  if (delta === 0) return <Minus size={13} color="var(--faint)" aria-label="No change" />;
  if (delta > 0) return (
    <span className="num" style={{ color: "var(--win)", display: "inline-flex", alignItems: "center", gap: 2 }}>
      <ArrowUp size={13} /> {delta}
    </span>
  );
  return (
    <span className="num" style={{ color: "var(--lose)", display: "inline-flex", alignItems: "center", gap: 2 }}>
      <ArrowDown size={13} /> {Math.abs(delta)}
    </span>
  );
}

/** THE FIELD: this week's picks, graded, ranked, and moving. */
export function WeeklyStandings({
  rows, previous, loading,
}: {
  rows: PickemWeeklyStanding[] | null;
  previous: PickemWeeklyStanding[] | null;
  loading: boolean;
}) {
  const prevRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of previous ?? []) m.set(r.user_id, r.rank);
    return m;
  }, [previous]);

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2>Weekly Standings</h2>
          <div className="eyebrow" style={{ marginTop: 5 }}>The house, straight up</div>
        </div>
        <Trophy size={17} color="var(--gold)" />
      </div>

      {loading && <SkeletonRows n={6} />}

      {!loading && rows && rows.length === 0 && (
        <div className="empty">No games this week yet.</div>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                {["", "Player", "Correct", "Incorrect", "Remaining", "Win %", "Move"].map((h, i) => (
                  <th key={i} className="eyebrow" scope="col" style={{
                    textAlign: i === 1 ? "left" : "right", padding: "var(--s3) var(--s4)",
                    borderBottom: "1px solid var(--rule)", whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const prev = prevRank.get(r.user_id);
                const delta = prev === undefined ? null : prev - r.rank;
                return (
                  <tr key={r.user_id} style={{
                    background: r.mine ? "var(--gold-haze)" : undefined,
                    borderBottom: "1px solid var(--rule-soft)",
                  }}>
                    <td className="num eyebrow" style={cell}>{r.rank}</td>
                    <td style={{ ...cell, fontWeight: r.mine ? 600 : 500, whiteSpace: "nowrap" }}>
                      {r.display_name}{r.mine && <span className="eyebrow" style={{ marginLeft: 6, color: "var(--wine)" }}>YOU</span>}
                    </td>
                    <td className="num" style={{ ...cell, color: "var(--win)" }}>{r.correct}</td>
                    <td className="num" style={{ ...cell, color: "var(--lose)" }}>{r.incorrect}</td>
                    <td className="num" style={{ ...cell, color: "var(--dim)" }}>{r.remaining}</td>
                    <td className="num" style={cell}>{r.win_pct.toFixed(1)}%</td>
                    <td style={{ ...cell, textAlign: "right" }}><Movement delta={delta} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** STEAKHOUSE STANDINGS: the whole season, summed. */
export function SeasonStandings({ rows, loading }: { rows: PickemSeasonStanding[] | null; loading: boolean }) {
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2>Season Standings</h2>
          <div className="eyebrow" style={{ marginTop: 5 }}>Every week, added up</div>
        </div>
        <Trophy size={17} color="var(--gold)" />
      </div>

      {loading && <SkeletonRows n={6} />}

      {!loading && rows && rows.length === 0 && (
        <div className="empty">Nothing to stand on yet — picks open once the schedule does.</div>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr>
                {["", "Player", "Correct", "Incorrect", "Total", "Win %", "Weekly Wins"].map((h, i) => (
                  <th key={i} className="eyebrow" scope="col" style={{
                    textAlign: i === 1 ? "left" : "right", padding: "var(--s3) var(--s4)",
                    borderBottom: "1px solid var(--rule)", whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} style={{
                  background: r.mine ? "var(--gold-haze)" : undefined,
                  borderBottom: "1px solid var(--rule-soft)",
                }}>
                  <td className="num eyebrow" style={cell}>{r.rank}</td>
                  <td style={{ ...cell, fontWeight: r.mine ? 600 : 500, whiteSpace: "nowrap" }}>
                    {r.display_name}{r.mine && <span className="eyebrow" style={{ marginLeft: 6, color: "var(--wine)" }}>YOU</span>}
                  </td>
                  <td className="num" style={{ ...cell, color: "var(--win)" }}>{r.correct}</td>
                  <td className="num" style={{ ...cell, color: "var(--lose)" }}>{r.incorrect}</td>
                  <td className="num" style={{ ...cell, color: "var(--dim)" }}>{r.total}</td>
                  <td className="num" style={cell}>{r.win_pct.toFixed(1)}%</td>
                  <td className="num" style={{ ...cell, color: "var(--gold)" }}>{r.weekly_wins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 🏆 the trophy card for a week that has fully settled. */
export function WeeklyChampionCard({ week, champions }: { week: number; champions: PickemWeeklyStanding[] }) {
  if (champions.length === 0) return null;
  const record = `${champions[0].correct}–${champions[0].incorrect}`;
  return (
    <div className="card" data-accent="gold" style={{ marginBottom: "var(--s4)" }}>
      <div className="card__body" style={{ display: "flex", alignItems: "center", gap: "var(--s4)", flexWrap: "wrap" }}>
        <Trophy size={28} color="var(--gold)" style={{ flexShrink: 0 }} />
        <div>
          <div className="eyebrow" data-tone="gold">Week {week} Champion</div>
          <div style={{ fontFamily: "var(--serif)", fontSize: "var(--t-head)", marginTop: 2 }}>
            {champions.map((c) => c.display_name).join(" & ")}
          </div>
        </div>
        <div className="num" style={{ marginLeft: "auto", fontSize: "var(--t-title)", color: "var(--gold)" }}>
          {record}
        </div>
      </div>
    </div>
  );
}
