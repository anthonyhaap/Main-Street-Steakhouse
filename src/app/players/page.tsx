"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X, Plus, UserMinus, Gavel } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { PoolPlayer } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { PlayerBadge } from "@/components/PlayerBadge";
import { SkeletonRows, useToast } from "@/components/ui";
import { DropPicker, type Owned } from "@/components/players/DropPicker";
import { ClaimSheet } from "@/components/waivers/ClaimSheet";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"] as const;

export default function PlayersPage() {
  const { ready, team } = useSession();
  const toast = useToast();
  const [pool, setPool] = useState<PoolPlayer[] | null>(null);
  const [owners, setOwners] = useState<Owned[]>([]);
  const [week, setWeek] = useState<number | null>(null);
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The player a full roster is trying to sign: the picker is open for him.
  const [signing, setSigning] = useState<PoolPlayer | null>(null);
  // Releasing is two clicks. One is how you cut a man you meant to start.
  const [confirming, setConfirming] = useState<string | null>(null);
  // A player somebody dropped is not signable — he goes to the best claim on
  // settlement day. Without this the page would offer a Sign button that the
  // database refuses every time.
  const [waivers, setWaivers] = useState<Map<string, string>>(new Map());
  const [claiming, setClaiming] = useState<PoolPlayer | null>(null);

  // Ownership comes from ff_pool_owners, not from the draft board. During the
  // draft the two agree — no transactions have happened — and after it only
  // this one is right.
  const loadOwners = useCallback(async () => {
    const [owned, wire] = await Promise.all([
      supabaseBrowser().rpc("ff_pool_owners", { p_league_id: LEAGUE_ID }),
      supabaseBrowser().rpc("ff_on_waivers", { p_league_id: LEAGUE_ID }),
    ]);
    setOwners((owned.data ?? []) as Owned[]);
    setWaivers(new Map(((wire.data ?? []) as { player_id: string; clears_at: string }[])
      .map((w) => [w.player_id, w.clears_at])));
  }, []);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const supabase = supabaseBrowser();
      const [p, w] = await Promise.all([
        supabase.from("draft_pool").select("*")
          .order("overall_rank", { ascending: true, nullsFirst: false }).range(0, 2499),
        supabase.rpc("ff_current_week"),
      ]);
      setPool((p.data ?? []) as PoolPlayer[]);
      setWeek((w.data as number) ?? 1);
      await loadOwners();
    })();
  }, [ready, loadOwners]);

  const taken = useMemo(() => new Map(owners.map((o) => [o.player_id, o.team])), [owners]);
  const mine = useMemo(
    () => (team ? owners.filter((o) => o.team_id === team.id) : []),
    [owners, team],
  );
  const mineIds = useMemo(() => new Set(mine.map((o) => o.player_id)), [mine]);
  const isMine = useCallback((id: string) => mineIds.has(id), [mineIds]);

  const rows = useMemo(() => {
    if (!pool) return [];
    const term = q.trim().toLowerCase();
    return pool
      .filter((p) => pos === "ALL" || p.position === pos)
      // On the wire is not free: the count below already excluded them, and a
      // filter that disagrees with its own total is worse than no filter.
      .filter((p) => !onlyFree || (!taken.has(p.id) && !waivers.has(p.id)))
      .filter((p) => !term || p.full_name.toLowerCase().includes(term) || (p.nfl_team ?? "").toLowerCase().includes(term))
      .slice(0, 300);
  }, [pool, pos, q, onlyFree, taken, waivers]);

  /**
   * Sign a free agent, dropping someone in the same move when one is named.
   *
   * A bare add onto a full roster is refused by the database rather than
   * guessed at here: the cap is the league's, the count is derived, and a
   * browser that decided for itself would be wrong the moment another manager
   * moved first. The refusal is what opens the picker.
   */
  const sign = useCallback(async (add: PoolPlayer, dropId?: string) => {
    if (!team) return;
    setBusy(add.id);
    const { data, error } = await supabaseBrowser().rpc("ff_add_drop", {
      p_team_id: team.id,
      p_add_player_id: add.id,
      p_drop_player_id: dropId ?? null,
      p_week: week,
    });
    setBusy(null);

    if (error) {
      if (/roster is full/i.test(error.message)) { setSigning(add); return; }
      toast("error", error.message);
      return;
    }
    setSigning(null);
    const gone = (data as { dropped?: string } | null)?.dropped;
    toast("ok", gone ? `${add.full_name} in, ${gone} out.` : `${add.full_name} is yours.`);
    await loadOwners();
  }, [team, week, toast, loadOwners]);

  /** Let a player go without signing anybody — the other half of add/drop. */
  const release = useCallback(async (playerId: string, name: string) => {
    if (!team) return;
    setBusy(playerId);
    const { error } = await supabaseBrowser().rpc("ff_add_drop", {
      p_team_id: team.id,
      p_add_player_id: null,
      p_drop_player_id: playerId,
      p_week: week,
    });
    setBusy(null);
    setConfirming(null);
    if (error) { toast("error", error.message); return; }
    toast("ok", `${name} is back in the pool.`);
    await loadOwners();
  }, [team, week, toast, loadOwners]);

  /** File a claim from the pool, rather than sending the manager elsewhere. */
  const claim = useCallback(async (add: PoolPlayer, dropId: string | null) => {
    if (!team) return;
    setBusy(add.id);
    const { error } = await supabaseBrowser().rpc("ff_claim_waiver", {
      p_team_id: team.id,
      p_add_player_id: add.id,
      p_drop_player_id: dropId,
      p_claim_order: null,
    });
    setBusy(null);
    if (error) { toast("error", error.message); return; }
    setClaiming(null);
    toast("ok", `Claim in for ${add.full_name}.`);
    await loadOwners();
  }, [team, toast, loadOwners]);

  const freeCount = useMemo(
    () => (pool ? pool.filter((p) => !taken.has(p.id) && !waivers.has(p.id)).length : 0),
    [pool, taken, waivers],
  );

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head">
            <h2>Players</h2>
            <span className="eyebrow"><span className="num">{freeCount}</span> free</span>
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
              <label className="eyebrow" style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer", marginLeft: "auto" }}>
                <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)}
                  style={{ accentColor: "var(--gold)" }} />
                Free agents only
              </label>
            </div>
          </div>

          {!pool && <SkeletonRows n={10} />}

          {pool && (
            <div className="rows">
              {rows.length === 0 && <div className="empty">Nobody matches that.</div>}
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
                      team ? (
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
                    ) : team ? (
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
      </main>

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
