"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Lock } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import type { RosterPoint } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { Seal, SkeletonRows, fmtPts, useCountUp, useToast } from "@/components/ui";

const FLEX_OK = new Set(["RB", "WR", "TE"]);
const slotOk = (slot: string, pos: string) =>
  slot === "BN" ? true : slot === "FLEX" ? FLEX_OK.has(pos) : slot === pos;

export default function TeamPage() {
  const { ready, team, league } = useSession();
  const toast = useToast();
  const [week, setWeek] = useState<number | null>(null);
  const [moving, setMoving] = useState<RosterPoint | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void supabaseBrowser().rpc("ff_current_week").then(({ data }) => setWeek((data as number) ?? 1));
  }, [ready]);

  const fetcher = useCallback(async () => {
    if (!team || week === null) return [] as RosterPoint[];
    const { data } = await supabaseBrowser()
      .from("roster_points").select("*").eq("team_id", team.id).eq("week", week);
    return (data ?? []) as RosterPoint[];
  }, [team, week]);

  const { data, status, refetch } = useLive<RosterPoint[]>(fetcher, {
    tables: ["rosters", "matchups"],
    channel: "my-team",
    pollMs: 30000,
    enabled: ready && !!team && week !== null,
  });

  const slots = league?.roster_slots ?? [];
  const rows = useMemo(() => data ?? [], [data]);

  const starters = useMemo(() => {
    const pool = rows.filter((r) => r.slot !== "BN");
    const used = new Set<string>();
    return slots.filter((s) => s !== "BN").map((slot, i) => {
      const hit = pool.find((r) => r.slot === slot && !used.has(r.player_id));
      if (hit) used.add(hit.player_id);
      return { key: `${slot}-${i}`, slot, row: hit ?? null };
    });
  }, [rows, slots]);

  const bench = rows.filter((r) => r.slot === "BN");
  const total = starters.reduce((sum, s) => sum + Number(s.row?.points ?? 0), 0);
  const shown = useCountUp(total);
  const empties = starters.filter((s) => !s.row).length;

  async function swap(target: { slot: string; row: RosterPoint | null }) {
    if (!moving || !team || week === null) return;
    if (!slotOk(target.slot, moving.position)) {
      toast("error", `A ${moving.position} can't play at ${target.slot}.`);
      return;
    }
    const assignments: Record<string, string> = { [moving.player_id]: target.slot };
    if (target.row) assignments[target.row.player_id] = moving.slot;

    setBusy(true);
    const { error } = await supabaseBrowser().rpc("ff_set_lineup", {
      p_team_id: team.id, p_week: week, p_assignments: assignments,
    });
    setBusy(false);
    setMoving(null);
    if (error) toast("error", error.message);
    await refetch();
  }

  if (!ready || (team && !data)) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="narrow"><div className="card"><SkeletonRows n={9} /></div></main>
      </>
    );
  }

  if (!team) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="narrow">
          <div className="card"><div className="empty">You aren&apos;t linked to a team yet.</div></div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="narrow">
        <div className="card">
          <div className="card__head">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
              <Seal name={team.name} mine size={38} />
              <div style={{ minWidth: 0 }}>
                <h2 style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.name}</h2>
                <div className="eyebrow" style={{ marginTop: 4 }}>Week {week ?? "—"} starters</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="score" style={{ fontSize: "clamp(1.7rem,5vw,2.3rem)", color: "var(--gold)" }}>
                {shown.toFixed(1)}
              </div>
              <div className="eyebrow" style={{ marginTop: 3 }}>Points</div>
            </div>
          </div>

          {empties > 0 && (
            <div className="note" data-kind="error">
              {empties} starting {empties === 1 ? "slot is" : "slots are"} empty — those score zero.
            </div>
          )}
          {moving && (
            <div className="note" data-kind="info" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span>Moving <strong>{moving.full_name}</strong> — choose a highlighted slot.</span>
              <button className="btn" data-v="ghost" data-size="sm" onClick={() => setMoving(null)}>Cancel</button>
            </div>
          )}

          <div className="rows">
            {starters.map((s) => (
              <Line key={s.key} slot={s.slot} row={s.row} busy={busy}
                highlight={!!moving && slotOk(s.slot, moving.position)}
                selected={!!moving && moving.player_id === s.row?.player_id}
                onClick={() => (moving ? swap(s) : s.row && setMoving(s.row))} />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2>Bench</h2>
            <span className="eyebrow"><span className="num">{bench.length}</span> players</span>
          </div>
          <div className="rows">
            {bench.length === 0 && <div className="empty">Bench is empty.</div>}
            {bench.map((r) => (
              <Line key={r.player_id} slot="BN" row={r} busy={busy}
                highlight={!!moving && !!moving.slot && moving.slot !== "BN"}
                selected={moving?.player_id === r.player_id}
                onClick={() => (moving ? swap({ slot: "BN", row: null }) : setMoving(r))} />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

function Line({
  slot, row, highlight, selected, busy, onClick,
}: {
  slot: string; row: RosterPoint | null; highlight: boolean; selected: boolean;
  busy: boolean; onClick: () => void;
}) {
  const locked = !!row?.locked_at && new Date(row.locked_at).getTime() <= Date.now();
  const clickable = !busy && !locked && (!!row || highlight);

  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className="row"
      data-hover={clickable}
      style={{
        width: "100%", textAlign: "left", font: "inherit", color: "inherit",
        border: 0, borderLeft: `2px solid ${selected ? "var(--gold)" : highlight ? "var(--gold-dim)" : "transparent"}`,
        background: selected ? "var(--gold-wash)" : highlight ? "var(--gold-haze)" : "transparent",
        cursor: clickable ? "pointer" : "default",
        opacity: locked ? 0.5 : 1,
      }}
    >
      <span className="pos" data-p={slot} style={{ minWidth: 42 }}>{slot}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {row ? (
          <>
            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.full_name}
              {locked && <Lock size={11} color="var(--faint)" />}
            </div>
            <div className="eyebrow" style={{ marginTop: 3, letterSpacing: "0.1em" }}>
              {row.position} · {row.nfl_team ?? "FA"}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--faint)", fontStyle: "italic" }}>Empty</span>
        )}
      </div>
      {row && <span className="num" style={{ fontSize: "var(--t-head)" }}>{fmtPts(row.points)}</span>}
      {clickable && row && <ArrowLeftRight size={13} color="var(--faint)" />}
    </button>
  );
}
