"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, Star, X } from "lucide-react";
import { PlayerBadge } from "@/components/PlayerBadge";
import { fillRoster, gradePick, marketRankOf, type PickGrade } from "@/lib/draft";
import type { BoardPick, PoolPlayer } from "@/lib/types";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"] as const;
type Tab = "available" | "queue" | "roster";
type Sort = "rank" | "proj";

/**
 * Projected points, as a column you can sort by.
 *
 * The board already ranked players by draft-market ADP, which is what everyone
 * else thinks they are worth. The projection is what *this* league's rules say
 * they are worth, and the two disagree in useful places — a quarterback can
 * project 345 points and still sit at ADP 34 because our passing rules are
 * stingier than the market's. That gap is the whole reason to show both.
 */
function Proj({ p }: { p: PoolPlayer }) {
  const pts = p.proj_total;
  if (pts == null) return <span className="pool__proj" data-empty="true">—</span>;
  return (
    <span className="pool__proj">
      <b className="num">{Number(pts).toFixed(0)}</b>
      <span>proj</span>
    </span>
  );
}

type Props = {
  pool: PoolPlayer[];
  /** The pick on the clock right now, so an available player can be graded
      as if he were taken this instant — the "is this a reach or a gift"
      read a manager actually needs before clicking Draft. */
  currentPick: number;
  draftedIds: Set<string>;
  /** Who took whom, for the drafted rows and the "taken" state. */
  takenBy?: Map<string, string>;
  queue: PoolPlayer[];
  myPicks: BoardPick[];
  /** The league's roster slots, so the roster tab reads as the lineup will. */
  slots?: string[];
  needs: string[];
  canPick: boolean;
  busy: boolean;
  onDraft: (p: PoolPlayer) => void;
  onQueueChange: (ids: string[]) => void;
  /** Open a player's card in place. Falls back to the full page when absent. */
  onOpen?: (playerId: string) => void;
};

export function Pool(props: Props) {
  const { pool, currentPick, draftedIds, takenBy, queue, myPicks, slots, needs, canPick, busy, onOpen } = props;
  const [tab, setTab] = useState<Tab>("available");
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [sort, setSort] = useState<Sort>("rank");
  const [q, setQ] = useState("");
  const [showDrafted, setShowDrafted] = useState(false);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);

  const available = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = pool
      .filter((p) => showDrafted || !draftedIds.has(p.id))
      .filter((p) => pos === "ALL" || p.position === pos)
      .filter((p) => !term || p.full_name.toLowerCase().includes(term) || (p.nfl_team ?? "").toLowerCase().includes(term));

    // Unprojected players sort last either way rather than pretending to be 0.
    const byProj = (a: PoolPlayer, b: PoolPlayer) =>
      Number(b.proj_total ?? -1) - Number(a.proj_total ?? -1);
    const byRank = (a: PoolPlayer, b: PoolPlayer) =>
      (a.overall_rank ?? 9999) - (b.overall_rank ?? 9999);

    return [...rows].sort(sort === "proj" ? byProj : byRank).slice(0, 250);
  }, [pool, draftedIds, pos, q, sort, showDrafted]);

  const queueIds = queue.map((p) => p.id);
  const liveQueue = queue.filter((p) => !draftedIds.has(p.id));
  const roster = useMemo(() => (slots?.length ? fillRoster(slots, myPicks) : null), [slots, myPicks]);

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

            <div style={{ display: "flex", gap: "var(--s3)", alignItems: "center", flexWrap: "wrap" }}>
              <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
                <div className="segmented" style={{ width: "max-content" }}>
                  {POSITIONS.map((p) => (
                    <button key={p} className="segmented__opt" data-on={pos === p} onClick={() => setPos(p)}>{p}</button>
                  ))}
                </div>
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: "var(--s3)", alignItems: "center" }}>
                <label className="eyebrow" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", whiteSpace: "nowrap" }}
                  title="Keep drafted players in the list, greyed out">
                  <input type="checkbox" checked={showDrafted} onChange={(e) => setShowDrafted(e.target.checked)}
                    style={{ accentColor: "var(--gold)" }} />
                  Show drafted
                </label>
                <div className="segmented" title="Order the board">
                  <button className="segmented__opt" data-on={sort === "rank"} onClick={() => setSort("rank")}>ADP</button>
                  <button className="segmented__opt" data-on={sort === "proj"} onClick={() => setSort("proj")}>Proj</button>
                </div>
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
                taken={draftedIds.has(p.id) ? (takenBy?.get(p.id) ?? "Taken") : null}
                grade={draftedIds.has(p.id) ? null : gradePick(currentPick, marketRankOf(p))}
                onOpen={onOpen}
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
                  <PlayerBadge
                    id={p.id}
                    name={p.full_name}
                    position={p.position}
                    team={p.nfl_team}
                    espnId={p.espn_id}
                    size={30}
                    onOpen={onOpen}
                    sub={
                      <>
                        <span>{p.nfl_team ?? "FA"}</span>
                        {p.bye_week ? <span>bye {p.bye_week}</span> : null}
                        {gone && <span style={{ color: "var(--qb)" }}>Taken</span>}
                      </>
                    }
                  />
                </div>
                <Proj p={p} />
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
          {/* Slot by slot, the way the lineup will seed — an empty FLEX reads
              as a need, not a blank. Falls back to a flat list of picks when
              the league's slots aren't known. */}
          {roster ? (
            <>
              {roster.map(({ slot, pick }, i) => {
                const bye = pick ? byId.get(pick.player_id)?.bye_week : null;
                return (
                  <div className="row" key={i} style={{ opacity: pick ? 1 : 0.6 }}>
                    <span className="pos" data-p={slot} style={{ minWidth: 42 }}>{slot}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {pick ? (
                        <PlayerBadge
                          id={pick.player_id}
                          name={pick.player_name}
                          position={pick.position}
                          team={pick.nfl_team}
                          espnId={pick.espn_id}
                          size={30}
                          onOpen={onOpen}
                          sub={
                            <>
                              <span>{pick.nfl_team ?? "FA"}</span>
                              <span className="num">R{pick.round}</span>
                              {pick.is_autopick && <span>Auto</span>}
                            </>
                          }
                        />
                      ) : (
                        <span style={{ fontSize: "var(--t-small)", color: "var(--faint)", fontStyle: "italic" }}>Empty</span>
                      )}
                    </div>
                    <span className="num" style={{ fontSize: "var(--t-micro)", color: "var(--dim)", width: 44, textAlign: "right" }}>
                      {bye ? `bye ${bye}` : ""}
                    </span>
                  </div>
                );
              })}
              <div style={{ padding: "var(--s3) var(--s4)" }}>
                <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>
                  {myPicks.length} of {roster.length} filled
                  {needs.length > 0 && <> · still need {needs.join(", ")}</>}
                </span>
              </div>
            </>
          ) : (
            <>
              {myPicks.length === 0 && <div className="empty">You haven&apos;t drafted anyone yet.</div>}
              {myPicks.map((p) => (
                <div className="row" key={p.player_id}>
                  <span className="num eyebrow" style={{ width: 26 }}>R{p.round}</span>
                  <span className="pos" data-p={p.position}>{p.position}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PlayerBadge
                      id={p.player_id}
                      name={p.player_name}
                      position={p.position}
                      team={p.nfl_team}
                      espnId={p.espn_id}
                      size={30}
                      onOpen={onOpen}
                      sub={
                        <>
                          <span>{p.nfl_team ?? "FA"}</span>
                          {p.is_autopick && <span>Auto</span>}
                        </>
                      }
                    />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  p, canPick, busy, queued, taken, grade, onOpen, onDraft, onQueue,
}: {
  p: PoolPlayer; canPick: boolean; busy: boolean; queued: boolean;
  /** Team that drafted him, when he is off the board. */
  taken: string | null;
  /** How he'd grade if drafted at the current pick — only worth showing when he's a bargain. */
  grade: PickGrade | null;
  onOpen?: (playerId: string) => void;
  onDraft: () => void; onQueue: () => void;
}) {
  const value = grade?.tone === "ok" ? grade : null;
  return (
    <div className="row" data-hover="true" style={taken ? { opacity: 0.5 } : undefined}>
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
          size={32}
          onOpen={onOpen}
          sub={
            <>
              <span>{p.nfl_team ?? "FA"}</span>
              {p.position_rank ? <span>{p.position}{p.position_rank}</span> : null}
              {p.bye_week ? <span>Bye {p.bye_week}</span> : null}
              {p.adp ? <span className="num">ADP {Number(p.adp).toFixed(1)}</span> : null}
              {value && (
                <span className="badge" data-tone="ok" style={{ minHeight: 17, fontSize: 9 }}
                  title={`${Math.abs(value.delta)} picks past his ADP`}>
                  {value.label}
                </span>
              )}
              {p.injury_status && (
                <span className="badge" data-tone="warn" style={{ minHeight: 17, fontSize: 9 }}>
                  {p.injury_status}
                </span>
              )}
            </>
          }
        />
      </div>

      <Proj p={p} />

      {taken ? (
        <>
          {/* He was on your board — keep the star in view, just spent,
              instead of swapping it for the team name and losing the cue
              that he was ever queued. */}
          {queued && <Star size={15} fill="none" style={{ color: "var(--faint)" }} aria-hidden />}
          <span className="eyebrow" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}
            title={taken}>
            {taken}
          </span>
        </>
      ) : (
        <>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onQueue}
            style={queued ? { color: "var(--gold)" } : undefined}
            title={queued ? "Remove from queue" : "Add to queue"}
            aria-label={queued ? "Remove from queue" : "Add to queue"}>
            <Star size={15} fill={queued ? "var(--gold)" : "none"} />
          </button>

          <button className="btn" data-v="primary" data-size="sm" disabled={!canPick || busy} onClick={onDraft}>
            Draft
          </button>
        </>
      )}
    </div>
  );
}
