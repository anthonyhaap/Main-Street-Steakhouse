"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";
import type { Outlook } from "@/lib/types";
import { SIMS, oddsCanSeparate, projectPlayoffs, rankKey, type PlayoffProjection } from "@/lib/playoffs";
import { Seal, SkeletonRows, fmtPts } from "@/components/ui";
import { Meter } from "@/components/dash";

/**
 * The standings, with the playoff picture worked out. Pure function of the
 * outlook payload so it renders from a fixture as well as from the league.
 */
export function StandingsBoard({ outlook, myTeamId, crestOf }: {
  outlook: Outlook | null;
  myTeamId?: string | null;
  /**
   * A team's crest by id. Passed in rather than looked up, so the board still
   * renders from a fixture — the playoff odds are the point of this component,
   * and they do not need a session.
   */
  crestOf?: (teamId: string) => string | null;
}) {
  // Before the draft there is nothing to tell twelve 0–0 teams apart, and the
  // simulation says so by producing twelve coin flips. Withhold it rather than
  // dress it up: see `oddsCanSeparate`.
  const separable = outlook ? oddsCanSeparate(outlook) : true;
  const proj = useMemo(
    () => (outlook && separable ? projectPlayoffs(outlook) : null),
    [outlook, separable],
  );
  const byId = useMemo(() => new Map((proj ?? []).map((p) => [p.team_id, p])), [proj]);

  const rows = useMemo(() => {
    if (!outlook) return [];
    // Nothing has happened yet: alphabetical, so the order claims nothing.
    if (!separable) return [...outlook.teams].sort((a, b) => a.name.localeCompare(b.name));
    return [...outlook.teams].sort(
      (a, b) =>
        rankKey(b) - rankKey(a)
        || Number(b.points_for) - Number(a.points_for)
        || (byId.get(b.id)?.playoff_pct ?? 0) - (byId.get(a.id)?.playoff_pct ?? 0)
        || a.name.localeCompare(b.name),
    );
  }, [outlook, byId, separable]);

  const left = outlook
    ? outlook.matchups.filter((m) => !m.played && m.week <= outlook.regular_season_weeks).length
    : 0;
  const started = outlook?.matchups.some((m) => m.played) ?? false;
  const showBye = (outlook?.playoff_byes ?? 0) > 0 && separable;
  const heads = separable
    ? ["", "Team", "W", "L", "T", "PF", "PA", "Diff", "Proj.", "Playoffs", ...(showBye ? ["Bye"] : [])]
    // Every other column is a zero in every row. A column of zeros is not data.
    : ["", "Team", "W", "L", "T"];

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2>Standings</h2>
          {outlook && (
            <div className="eyebrow" style={{ marginTop: 5 }}>
              Week {outlook.week} · Top {outlook.playoff_teams} make the playoffs
              {showBye && ` · ${outlook.playoff_byes} first-round bye${outlook.playoff_byes === 1 ? "" : "s"}`}
            </div>
          )}
        </div>
        <Trophy size={17} color="var(--gold)" />
      </div>

      {!outlook && <SkeletonRows n={12} />}

      {outlook && outlook.matchups.length === 0 && (
        <div className="empty">
          No schedule yet.<br />Standings and playoff odds appear once the season schedule is generated.
        </div>
      )}

      {outlook && outlook.matchups.length > 0 && (
        <>
          <div className="note" data-kind="info">
            {!separable
              ? "Playoff odds unlock after the draft. Until every seat has a roster there is nothing to tell twelve 0–0 teams apart — the simulation would hand all of them a coin flip and a projected 7–7, which looks like analysis and is not."
              : left === 0
              ? "The regular season is in the books. Seeds are final."
              : started
              ? `Odds come from ${SIMS.toLocaleString()} simulated seasons, using results so far and what each lineup is projected to score. ${left} regular-season game${left === 1 ? "" : "s"} left.`
              : `Nobody has kicked off yet, so these odds lean entirely on projected lineups. ${SIMS.toLocaleString()} simulated seasons; the numbers firm up as results come in.`}
          </div>

          <div className="scroll" style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%", borderCollapse: "collapse",
              minWidth: !separable ? 380 : showBye ? 860 : 780,
            }}>
              <thead>
                <tr>
                  {heads.map((h, i) => (
                    <th key={i} className="eyebrow" scope="col"
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
                {rows.map((t, i) => {
                  const p = byId.get(t.id);
                  const pf = Number(t.points_for), pa = Number(t.points_against);
                  const diff = pf - pa;
                  const mine = t.id === myTeamId;
                  // A cut line drawn across an alphabetical list would be a
                  // claim about six teams that nothing has happened to.
                  const cutoff = separable && i + 1 === outlook.playoff_teams;
                  const byeLine = showBye && i + 1 === outlook.playoff_byes;
                  return (
                    <tr key={t.id} style={{
                      background: mine ? "var(--gold-haze)" : undefined,
                      borderBottom: cutoff ? "2px solid var(--gold-lit)"
                        : byeLine ? "1px dashed var(--gold-dim)"
                        : "1px solid var(--rule-soft)",
                    }}>
                      <td className="num eyebrow" style={{ padding: "var(--s3) var(--s4)" }}>
                        {separable ? i + 1 : "–"}
                      </td>
                      <td style={{ padding: "var(--s3) var(--s4)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                          <Seal name={t.name} src={crestOf?.(t.id) ?? null} mine={mine} size={28} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ whiteSpace: "nowrap", fontWeight: mine ? 600 : 500 }}>{t.name}</div>
                            {t.manager_name && (
                              <div style={{ fontSize: "var(--t-micro)", color: "var(--dim)", whiteSpace: "nowrap", marginTop: 1 }}>
                                {t.manager_name}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="num" style={cell}>{t.wins}</td>
                      <td className="num" style={cell}>{t.losses}</td>
                      <td className="num" style={{ ...cell, color: "var(--dim)" }}>{t.ties}</td>
                      {separable && (
                        <>
                          <td className="num" style={cell}>{fmtPts(pf)}</td>
                          <td className="num" style={{ ...cell, color: "var(--muted)" }}>{fmtPts(pa)}</td>
                          <td className="num" style={{ ...cell, color: diff >= 0 ? "var(--win)" : "var(--lose)" }}>
                            {diff >= 0 ? "+" : ""}{diff.toFixed(1)}
                          </td>
                          <td className="num" style={{ ...cell, color: "var(--muted)" }} title="Projected final record">
                            {p ? `${p.proj_wins.toFixed(1)}–${p.proj_losses.toFixed(1)}` : "—"}
                          </td>
                          <td style={cell}><Odds p={p} kind="playoff" /></td>
                          {showBye && <td style={cell}><Odds p={p} kind="bye" /></td>}
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card__body" style={{ paddingTop: "var(--s3)", display: "flex", gap: "var(--s4)", flexWrap: "wrap" }}>
            {separable ? (
              <>
                <span className="eyebrow"><i style={swatch("var(--gold-lit)")} /> Playoff line</span>
                {showBye && <span className="eyebrow"><i style={{ ...swatch("transparent"), borderTop: "1px dashed var(--gold-dim)" }} /> Bye line</span>}
                <span className="eyebrow" style={{ marginLeft: "auto" }}>Proj. is the expected final record</span>
              </>
            ) : (
              <span className="eyebrow">Listed alphabetically · no seeding until week one</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Odds({ p, kind }: { p?: PlayoffProjection; kind: "playoff" | "bye" }) {
  if (!p) return <span style={{ color: "var(--faint)" }}>—</span>;
  if (kind === "playoff") {
    if (p.status === "eliminated") return <span className="badge" data-tone="danger">Out</span>;
    if (p.status === "clinched" || p.status === "clinched_bye") return <span className="badge" data-tone="ok">Clinched</span>;
    return <Pct value={p.playoff_pct} />;
  }
  if (p.status === "clinched_bye") return <span className="badge" data-tone="ok">Locked</span>;
  if (p.status === "eliminated") return <span style={{ color: "var(--faint)" }}>—</span>;
  return <Pct value={p.bye_pct} muted />;
}

/**
 * Only unsettled odds reach here; clinches and eliminations are badges. So a
 * simulated 0 or 100 is shown as "<1%" or ">99%": the sim cannot back the
 * certainty, and the exact check has already said it is not there.
 */
function Pct({ value, muted = false }: { value: number; muted?: boolean }) {
  const r = Math.round(value);
  const label = r <= 0 ? "<1%" : r >= 100 ? ">99%" : `${r}%`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
      <span className="num" style={{ minWidth: 40, textAlign: "right", color: muted || value < 50 ? "var(--muted)" : "var(--cream)" }}>
        {label}
      </span>
      <span style={{ width: 54, display: "inline-block" }}>
        <Meter pct={value} tone={value >= 50 ? "ok" : undefined} />
      </span>
    </span>
  );
}

const cell: React.CSSProperties = { padding: "var(--s3) var(--s4)", textAlign: "right", whiteSpace: "nowrap" };

const swatch = (color: string): React.CSSProperties => ({
  display: "inline-block", width: 18, height: 0, borderTop: `2px solid ${color}`,
  verticalAlign: "middle", marginRight: 6,
});
