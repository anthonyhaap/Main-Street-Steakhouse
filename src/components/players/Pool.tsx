"use client";

import { useCallback, useMemo, useState } from "react";
import { Search, X, Plus, UserMinus, Gavel } from "lucide-react";
import type { PoolPlayer } from "@/lib/types";
import { PlayerBadge } from "@/components/PlayerBadge";
import { SkeletonRows } from "@/components/ui";
import { DropPicker, type Owned } from "@/components/players/DropPicker";
import { ClaimSheet } from "@/components/waivers/ClaimSheet";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"] as const;

/**
 * What the list is of. "Available" is every player nobody owns — a free agent
 * you can sign outright, or a man on the wire you can claim. "Everyone" is the
 * whole pool, rostered players included, which is where you release your own
 * and see who has whom.
 */
const VIEWS = [
  { key: "available", label: "Available" },
  { key: "everyone",  label: "Everyone" },
] as const;

type View = (typeof VIEWS)[number]["key"];

/**
 * What came of asking to sign somebody. "full" is the one answer the list acts
 * on itself: the database refused a bare add because the roster is full, so
 * the picker opens and the same signing goes up again with a drop named.
 */
export type SignResult = "done" | "full" | "failed";

/**
 * The player pool: who is available, and what you may do about them.
 *
 * It opens on the available players rather than the whole pool. Ordered by
 * rank, the first two hundred names in the pool are the ones that were
 * drafted, so a list of everybody was a wall of other managers' rosters with
 * the free agents starting somewhere below the fold — and the question a
 * manager brings to this tab is "who can I sign", not "who does everyone
 * have". The whole pool is one tap away for the times that is the question.
 *
 * Presentation only, so the fixture at /preview/players can hold it still.
 * The panel above it owns the fetching and the RPCs; what arrives here is the
 * pool, who owns whom, who is on the wire, and three things a manager can ask
 * for. The list keeps the state that is only ever the list's — the view, the
 * filters, which sheet is open, the second click a release takes.
 */
export function Pool({
  pool, owners, waivers, teamId, busy, onSign, onRelease, onClaim,
}: {
  /** Null while it is still loading. */
  pool: PoolPlayer[] | null;
  owners: Owned[];
  /** Player id → when he clears. */
  waivers: Map<string, string>;
  /** The manager's team, or null for a visitor who can only look. */
  teamId: string | null;
  /** The player a request is in flight for. */
  busy: string | null;
  onSign: (add: PoolPlayer, dropId?: string) => Promise<SignResult>;
  onRelease: (playerId: string, name: string) => Promise<void>;
  onClaim: (add: PoolPlayer, dropId: string | null) => Promise<boolean>;
}) {
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("available");
  // The player a full roster is trying to sign: the picker is open for him.
  const [signing, setSigning] = useState<PoolPlayer | null>(null);
  // Releasing is two clicks. One is how you cut a man you meant to start.
  const [confirming, setConfirming] = useState<string | null>(null);
  // A player somebody dropped is not signable — he goes to the best claim on
  // settlement day. Without this the page would offer a Sign button that the
  // database refuses every time.
  const [claiming, setClaiming] = useState<PoolPlayer | null>(null);

  const taken = useMemo(() => new Map(owners.map((o) => [o.player_id, o.team])), [owners]);
  const mine = useMemo(
    () => (teamId ? owners.filter((o) => o.team_id === teamId) : []),
    [owners, teamId],
  );
  const mineIds = useMemo(() => new Set(mine.map((o) => o.player_id)), [mine]);
  const isMine = useCallback((id: string) => mineIds.has(id), [mineIds]);

  // Everybody the position and the search allow, before the view decides
  // between them — so an empty available list can say how many of the matches
  // it is hiding rather than claiming nobody exists.
  const matches = useMemo(() => {
    if (!pool) return [];
    const term = q.trim().toLowerCase();
    return pool
      .filter((p) => pos === "ALL" || p.position === pos)
      .filter((p) => !term || p.full_name.toLowerCase().includes(term) || (p.nfl_team ?? "").toLowerCase().includes(term));
  }, [pool, pos, q]);

  // Available is "nobody owns him". A man on the wire is not on a roster —
  // he has a Claim button rather than a Sign button, and the count in the
  // head says how many of each so the list agrees with its own total.
  const rows = useMemo(
    () => matches.filter((p) => view === "everyone" || !taken.has(p.id)).slice(0, 300),
    [matches, view, taken],
  );
  const rostered = useMemo(
    () => (view === "available" ? matches.length - matches.filter((p) => !taken.has(p.id)).length : 0),
    [matches, view, taken],
  );

  const freeCount = useMemo(
    () => (pool ? pool.filter((p) => !taken.has(p.id) && !waivers.has(p.id)).length : 0),
    [pool, taken, waivers],
  );
  const waivedCount = useMemo(
    () => (pool ? pool.filter((p) => !taken.has(p.id) && waivers.has(p.id)).length : 0),
    [pool, taken, waivers],
  );

  const sign = useCallback(async (add: PoolPlayer, dropId?: string) => {
    const result = await onSign(add, dropId);
    if (result === "full") { setSigning(add); return; }
    if (result === "done") setSigning(null);
  }, [onSign]);

  const release = useCallback(async (playerId: string, name: string) => {
    await onRelease(playerId, name);
    setConfirming(null);
  }, [onRelease]);

  const claim = useCallback(async (add: PoolPlayer, dropId: string | null) => {
    if (await onClaim(add, dropId)) setClaiming(null);
  }, [onClaim]);

  return (
    <>
      <div className="card">
        <div className="card__head">
          <h2>Players</h2>
          <span className="eyebrow">
            <span className="num">{freeCount}</span> free
            {waivedCount > 0 && <> · <span className="num">{waivedCount}</span> on waivers</>}
          </span>
        </div>

        <div style={{ padding: "var(--s3) var(--s4)", borderBottom: "1px solid var(--rule)", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--s3)", minWidth: 0 }}>
          <div style={{ position: "relative", minWidth: 0 }}>
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
            <div className="segmented" style={{ marginLeft: "auto" }} role="group" aria-label="Show">
              {VIEWS.map((v) => (
                <button key={v.key} className="segmented__opt" data-on={view === v.key}
                  aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label}</button>
              ))}
            </div>
          </div>
        </div>

        {!pool && <SkeletonRows n={10} />}

        {pool && (
          <div className="rows">
            {rows.length === 0 && (
              <div className="empty">
                {rostered > 0 ? (
                  <>
                    Nobody available matches that
                    {" — "}<span className="num">{rostered}</span> {rostered === 1 ? "is" : "are"} on a roster.{" "}
                    <button className="btn" data-v="ghost" data-size="sm" onClick={() => setView("everyone")}
                      style={{ display: "inline-flex", verticalAlign: "middle" }}>
                      Show everyone
                    </button>
                  </>
                ) : view === "available" ? "Nobody available matches that." : "Nobody matches that."}
              </div>
            )}
            {rows.map((p) => {
              const owner = taken.get(p.id);
              return (
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

                  {owner && isMine(p.id) ? (
                    <button
                      className="btn"
                      data-size="sm"
                      data-v={confirming === p.id ? "danger" : "ghost"}
                      disabled={busy === p.id}
                      onClick={() => (confirming === p.id
                        ? void release(p.id, p.full_name)
                        : setConfirming(p.id))}
                      onBlur={() => setConfirming((c) => (c === p.id ? null : c))}
                      aria-label={confirming === p.id
                        ? `Confirm releasing ${p.full_name}`
                        : `Release ${p.full_name}`}
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <UserMinus size={13} />
                      {busy === p.id ? "…" : confirming === p.id ? "Sure?" : "Release"}
                    </button>
                  ) : owner ? (
                    <span className="eyebrow" style={{
                      color: "var(--muted)", maxWidth: 110, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right",
                    }}>{owner}</span>
                  ) : waivers.has(p.id) ? (
                    teamId ? (
                      <button
                        className="btn"
                        data-size="sm"
                        data-v="ghost"
                        disabled={busy === p.id}
                        onClick={() => setClaiming(p)}
                        aria-label={`Claim ${p.full_name} off waivers`}
                        style={{ display: "flex", alignItems: "center", gap: 5 }}
                      >
                        <Gavel size={13} />{busy === p.id ? "…" : "Claim"}
                      </button>
                    ) : (
                      <span className="eyebrow" style={{ color: "var(--muted)", textAlign: "right" }}>
                        On waivers
                      </span>
                    )
                  ) : teamId ? (
                    <button
                      className="btn" data-size="sm"
                      disabled={busy === p.id}
                      onClick={() => void sign(p)}
                      aria-label={`Sign ${p.full_name}`}
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <Plus size={13} />{busy === p.id ? "…" : "Sign"}
                    </button>
                  ) : (
                    <span className="eyebrow" style={{ color: "var(--win)", textAlign: "right" }}>Free agent</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {claiming && (
        <ClaimSheet
          player={{ id: claiming.id, name: claiming.full_name }}
          roster={mine}
          settlesAt={waivers.get(claiming.id) ?? null}
          busy={busy === claiming.id}
          onCancel={() => setClaiming(null)}
          onSubmit={(dropId) => void claim(claiming, dropId)}
        />
      )}

      {signing && (
        <DropPicker
          signing={signing}
          roster={mine}
          busy={busy === signing.id}
          onCancel={() => setSigning(null)}
          onDrop={(dropId) => void sign(signing, dropId)}
        />
      )}
    </>
  );
}
