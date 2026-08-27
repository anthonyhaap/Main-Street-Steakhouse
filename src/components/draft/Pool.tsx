"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, Star, X } from "lucide-react";
import type { BoardPick, PoolPlayer } from "@/lib/types";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"] as const;
type Tab = "available" | "queue" | "roster";

type Props = {
  pool: PoolPlayer[];
  draftedIds: Set<string>;
  queue: PoolPlayer[];
  myPicks: BoardPick[];
  needs: string[];
  canPick: boolean;
  busy: boolean;
  onDraft: (p: PoolPlayer) => void;
  onQueueChange: (ids: string[]) => void;
};

export function Pool(props: Props) {
  const { pool, draftedIds, queue, myPicks, needs, canPick, busy } = props;
  const [tab, setTab] = useState<Tab>("available");
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [q, setQ] = useState("");

  const available = useMemo(() => {
    const term = q.trim().toLowerCase();
    return pool
      .filter((p) => !draftedIds.has(p.id))
      .filter((p) => pos === "ALL" || p.position === pos)
      .filter((p) => !term || p.full_name.toLowerCase().includes(term) || (p.nfl_team ?? "").toLowerCase().includes(term))
      .slice(0, 250);
  }, [pool, draftedIds, pos, q]);

  const queueIds = queue.map((p) => p.id);
  const liveQueue = queue.filter((p) => !draftedIds.has(p.id));

  function move(id: string, dir: -1 | 1) {
    const i = queueIds.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= queueIds.length) return;
    const next = [...queueIds];
    [next[i], next[j]] = [next[j], next[i]];
    props.onQueueChange(next);
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="card__head" style={{ padding: "var(--s3) var(--s4)" }}>
        <div className="segmented">
          {(["available", "queue", "roster"] as const).map((t) => (
            <button key={t} className="segmented__opt" data-on={tab === t} onClick={() => setTab(t)}>
              {t === "available" ? "Available" : t === "queue" ? `Queue${liveQueue.length ? ` ${liveQueue.length}` : ""}` : `Roster ${myPicks.length}`}
            </button>
          ))}
        </div>
      </div>

      {tab === "available" && (
        <>
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

            <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
              <div className="segmented" style={{ width: "max-content" }}>
                {POSITIONS.map((p) => (
                  <button key={p} className="segmented__opt" data-on={pos === p} onClick={() => setPos(p)}>{p}</button>
                ))}
              </div>
            </div>

            {needs.length > 0 && (
              <div className="eyebrow" style={{ color: "var(--muted)", letterSpacing: "0.12em" }}>
                Still need · {needs.join(" · ")}
              </div>
            )}
          </div>

          <div className="scroll rows" style={{ flex: 1, minHeight: 220 }}>
            {available.length === 0 && <div className="empty">Nobody matches that.</div>}
            {available.map((p) => (
              <PlayerRow key={p.id} p={p} canPick={canPick} busy={busy}
                queued={queueIds.includes(p.id)}
                onDraft={() => props.onDraft(p)}
                onQueue={() => props.onQueueChange(
                  queueIds.includes(p.id) ? queueIds.filter((x) => x !== p.id) : [...queueIds, p.id],
                )} />
            ))}
          </div>
        </>
      )}

      {tab === "queue" && (
        <div className="scroll rows" style={{ flex: 1, minHeight: 220 }}>
          {queue.length === 0 && (
            <div className="empty">
              Nothing queued.
              <br />
              Star players on Available — if your clock runs out,
              <br />
              autopick takes the highest one still on the board.
            </div>
          )}
          {queue.map((p, i) => {
            const gone = draftedIds.has(p.id);
            return (
              <div className="row" key={p.id} style={{ opacity: gone ? 0.42 : 1 }}>
                <span className="num eyebrow" style={{ width: 16 }}>{i + 1}</span>
                <span className="pos" data-p={p.position}>{p.position}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: gone ? "line-through" : undefined }}>
                    {p.full_name}
                  </div>
                  <div className="eyebrow" style={{ marginTop: 3, letterSpacing: "0.1em" }}>
                    {p.nfl_team ?? "FA"}{p.bye_week ? ` · bye ${p.bye_week}` : ""}
                  </div>
                </div>
                {gone && <span className="eyebrow" style={{ color: "var(--qb)" }}>Taken</span>}
                <button className="btn" data-v="ghost" data-size="icon" onClick={() => move(p.id, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp size={14} /></button>
                <button className="btn" data-v="ghost" data-size="icon" onClick={() => move(p.id, 1)} disabled={i === queue.length - 1} aria-label="Move down"><ChevronDown size={14} /></button>
                <button className="btn" data-v="ghost" data-size="icon" onClick={() => props.onQueueChange(queueIds.filter((x) => x !== p.id))} aria-label="Remove"><X size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "roster" && (
        <div className="scroll rows" style={{ flex: 1, minHeight: 220 }}>
          {myPicks.length === 0 && <div className="empty">You haven&apos;t drafted anyone yet.</div>}
          {myPicks.map((p) => (
            <div className="row" key={p.player_id}>
              <span className="num eyebrow" style={{ width: 26 }}>R{p.round}</span>
              <span className="pos" data-p={p.position}>{p.position}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{p.player_name}</div>
                <div className="eyebrow" style={{ marginTop: 3, letterSpacing: "0.1em" }}>{p.nfl_team ?? "FA"}</div>
              </div>
              {p.is_autopick && <span className="eyebrow">Auto</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  p, canPick, busy, queued, onDraft, onQueue,
}: {
  p: PoolPlayer; canPick: boolean; busy: boolean; queued: boolean;
  onDraft: () => void; onQueue: () => void;
}) {
  return (
    <div className="row" data-hover="true">
      <span className="num" style={{ width: 26, fontSize: "var(--t-micro)", color: "var(--faint)", textAlign: "right" }}>
        {p.overall_rank ?? "–"}
      </span>
      <span className="pos" data-p={p.position}>{p.position}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.full_name}
        </div>
        <div className="eyebrow" style={{ marginTop: 3, letterSpacing: "0.1em", display: "flex", gap: 7, flexWrap: "wrap" }}>
          <span>{p.nfl_team ?? "FA"}</span>
          {p.position_rank ? <span>{p.position}{p.position_rank}</span> : null}
          {p.bye_week ? <span>Bye {p.bye_week}</span> : null}
          {p.adp ? <span className="num">ADP {Number(p.adp).toFixed(1)}</span> : null}
        </div>
      </div>

      <button className="btn" data-v="ghost" data-size="icon" onClick={onQueue}
        style={queued ? { color: "var(--gold)" } : undefined}
        title={queued ? "Remove from queue" : "Add to queue"}
        aria-label={queued ? "Remove from queue" : "Add to queue"}>
        <Star size={15} fill={queued ? "var(--gold)" : "none"} />
      </button>

      <button className="btn" data-v="primary" data-size="sm" disabled={!canPick || busy} onClick={onDraft}>
        Draft
      </button>
    </div>
  );
}
