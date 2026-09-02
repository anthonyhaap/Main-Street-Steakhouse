"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import { crestUrl } from "@/lib/crest";
import type { Matchup, RosterPoint, Team } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { Seal, SkeletonRows, fmtPts, useCountUp } from "@/components/ui";

type Board = { matchups: Matchup[]; points: RosterPoint[]; teams: Team[] };

export default function MatchupsPage() {
  const { ready, team, league } = useSession();
  const [week, setWeek] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    void supabaseBrowser().rpc("ff_current_week").then(({ data }) => setWeek((data as number) ?? 1));
  }, [ready]);

  const fetcher = useCallback(async (): Promise<Board> => {
    const supabase = supabaseBrowser();
    const [m, p, t] = await Promise.all([
      supabase.from("matchups").select("*").eq("league_id", LEAGUE_ID).eq("week", week!),
      supabase.from("roster_points").select("*").eq("league_id", LEAGUE_ID).eq("week", week!),
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
    ]);
    return {
      matchups: (m.data ?? []) as Matchup[],
      points: (p.data ?? []) as RosterPoint[],
      teams: (t.data ?? []) as Team[],
    };
  }, [week]);

  const { data, status } = useLive<Board>(fetcher, {
    tables: ["matchups", "rosters"],
    channel: "scoreboard",
    pollMs: 20000,
    enabled: ready && week !== null,
  });

  const weeks = Number((league?.settings as { regular_season_weeks?: number })?.regular_season_weeks ?? 14) + 3;
  const nameOf = (id: string) => data?.teams.find((t) => t.id === id)?.name ?? "—";
  const managerOf = (id: string) => data?.teams.find((t) => t.id === id)?.manager_name ?? null;
  const crestOf = (id: string) => crestUrl(data?.teams.find((t) => t.id === id)?.logo_path);
  const startersFor = (id: string) => (data?.points ?? []).filter((r) => r.team_id === id && r.slot !== "BN");

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="mid">
        <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
              <button key={w} className="segmented__opt num" data-on={w === week} onClick={() => setWeek(w)}>
                {w}
              </button>
            ))}
          </div>
        </div>

        {!data && <div className="card"><SkeletonRows n={6} /></div>}
        {data?.matchups.length === 0 && (
          <div className="card"><div className="empty">No matchups for week {week} yet.<br />The schedule posts after the draft.</div></div>
        )}

        {data?.matchups.map((m) => {
          const isOpen = open === m.id;
          const mine = m.home_team_id === team?.id || m.away_team_id === team?.id;
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
                  <Side name={nameOf(m.away_team_id)} manager={managerOf(m.away_team_id)} crest={crestOf(m.away_team_id)}
                    pts={ap} win={ap > hp} mine={m.away_team_id === team?.id} />
                  <Side name={nameOf(m.home_team_id)} manager={managerOf(m.home_team_id)} crest={crestOf(m.home_team_id)}
                    pts={hp} win={hp > ap} mine={m.home_team_id === team?.id} />
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
                        {list.length === 0 && <div className="empty" style={{ padding: "var(--s5)", fontSize: "var(--t-small)" }}>No lineup set.</div>}
                        {list.map((r) => (
                          <div key={r.player_id} style={{ display: "flex", gap: "var(--s2)", alignItems: "center", padding: "6px var(--s4)" }}>
                            <span className="pos" data-p={r.slot} style={{ minWidth: 38, height: 18, fontSize: 9 }}>{r.slot}</span>
                            <span style={{ flex: 1, fontSize: "var(--t-small)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {r.full_name}
                            </span>
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
      </main>
    </>
  );
}

function Side({ name, manager, crest, pts, win, mine }: {
  name: string; manager: string | null; crest: string | null; pts: number; win: boolean; mine: boolean;
}) {
  const shown = useCountUp(pts);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", minWidth: 0 }}>
        <Seal name={name} src={crest} mine={mine} size={26} />
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
