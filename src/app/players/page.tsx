"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { DRAFT_ID } from "@/lib/config";
import type { PoolPlayer } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { PlayerBadge } from "@/components/PlayerBadge";
import { SkeletonRows } from "@/components/ui";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"] as const;

export default function PlayersPage() {
  const { ready } = useSession();
  const [pool, setPool] = useState<PoolPlayer[] | null>(null);
  const [taken, setTaken] = useState<Map<string, string>>(new Map());
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const supabase = supabaseBrowser();
      const [p, d] = await Promise.all([
        supabase.from("draft_pool").select("*")
          .order("overall_rank", { ascending: true, nullsFirst: false }).range(0, 2499),
        supabase.from("draft_board").select("player_id,team_name").eq("draft_id", DRAFT_ID),
      ]);
      setPool((p.data ?? []) as PoolPlayer[]);
      setTaken(new Map(((d.data ?? []) as { player_id: string; team_name: string }[])
        .map((r) => [r.player_id, r.team_name])));
    })();
  }, [ready]);

  const rows = useMemo(() => {
    if (!pool) return [];
    const term = q.trim().toLowerCase();
    return pool
      .filter((p) => pos === "ALL" || p.position === pos)
      .filter((p) => !onlyFree || !taken.has(p.id))
      .filter((p) => !term || p.full_name.toLowerCase().includes(term) || (p.nfl_team ?? "").toLowerCase().includes(term))
      .slice(0, 300);
  }, [pool, pos, q, onlyFree, taken]);

  return (
    <>
      <TopBar />
      <main className="page" data-width="narrow">
        <div className="card">
          <div className="card__head">
            <h2>Players</h2>
            <span className="eyebrow"><span className="num">{pool?.length ?? 0}</span> in the pool</span>
          </div>

          <div style={{ padding: "var(--s3) var(--s4)", borderBottom: "1px solid var(--rule)", display: "grid", gap: "var(--s3)" }}>
            <div style={{ position: "relative" }}>
              <Search size={15} style={{ position: "absolute", left: 12, top: 13, color: "var(--faint)", pointerEvents: "none" }} />
              <input className="field" style={{ paddingLeft: 36, paddingRight: 36 }}
                placeholder="Search players or NFL teams" value={q}
                onChange={(e) => setQ(e.target.value)} aria-label="Search players" />
              {q && (
                <button onClick={() => setQ("")} aria-label="Clear search"
                  style={{ position: "absolute", right: 9, top: 10, background: "none", border: 0, color: "var(--dim)", cursor: "pointer", padding: 4 }}>
                  <X size={14} />
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: "var(--s3)", alignItems: "center", flexWrap: "wrap" }}>
              <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
                <div className="segmented" style={{ width: "max-content" }}>
                  {POSITIONS.map((p) => (
                    <button key={p} className="segmented__opt" data-on={pos === p} onClick={() => setPos(p)}>{p}</button>
                  ))}
                </div>
              </div>
              <label className="eyebrow" style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer", marginLeft: "auto" }}>
                <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)}
                  style={{ accentColor: "var(--gold)" }} />
                Undrafted only
              </label>
            </div>
          </div>

          {!pool && <SkeletonRows n={10} />}

          {pool && (
            <div className="rows">
              {rows.length === 0 && <div className="empty">Nobody matches that.</div>}
              {rows.map((p) => (
                <div className="row" key={p.id} data-hover="true">
                  <span className="num" style={{ width: 26, fontSize: "var(--t-micro)", color: "var(--faint)", textAlign: "right" }}>
                    {p.overall_rank ?? "–"}
                  </span>
                  <span className="pos" data-p={p.position}>{p.position}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PlayerBadge
                      id={p.id}
                      name={p.full_name}
                      position={p.position}
                      team={p.nfl_team}
                      espnId={p.espn_id}
                      size={34}
                      sub={
                        <>
                          <span>{p.nfl_team ?? "FA"}</span>
                          {p.position_rank ? <span>{p.position}{p.position_rank}</span> : null}
                          {p.bye_week ? <span>Bye {p.bye_week}</span> : null}
                          {p.adp ? <span className="num">ADP {Number(p.adp).toFixed(1)}</span> : null}
                        </>
                      }
                    />
                  </div>
                  <span className="eyebrow" style={{
                    color: taken.has(p.id) ? "var(--muted)" : "var(--win)",
                    maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right",
                  }}>
                    {taken.get(p.id) ?? "Free agent"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
