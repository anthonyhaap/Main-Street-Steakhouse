"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import type { HubPlayer, TeamHub, Wire } from "@/lib/nfl/types";
import { TopBar } from "@/components/Shell";
import { SkeletonRows, useToast } from "@/components/ui";
import { TeamDesk, slotOk, type MoveTarget } from "@/components/team/TeamDesk";

/**
 * The NFL wire, kept warm.
 *
 * It is deliberately not part of `useLive`: nothing in Postgres changes when
 * ESPN publishes a story, so there is no realtime signal to hang it on, and a
 * failure here must not colour the page's wire indicator. Refetch on an
 * interval and when the tab comes back, same contract as everything else —
 * whenever you look at it, it is current.
 */
function useWire() {
  const [wire, setWire] = useState<Wire | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/nfl/wire");
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Wire;
        if (alive) setWire(body);
      } catch {
        // A dead wire is a state the page draws, not an error it throws.
        if (alive) {
          setWire({
            fetchedAt: new Date().toISOString(),
            articles: [], injuries: [],
            sources: [{ name: "news", ok: false }, { name: "injuries", ok: false }],
          });
        }
      }
    };

    void load();
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 300000);
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return wire;
}

export default function TeamPage() {
  const { ready, team } = useSession();
  const toast = useToast();
  const [week, setWeek] = useState<number | null>(null);
  const [moving, setMoving] = useState<HubPlayer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void supabaseBrowser().rpc("ff_current_week").then(({ data }) => setWeek((data as number) ?? 1));
  }, [ready]);

  const fetcher = useCallback(async () => {
    if (!team || week === null) return null;
    const { data, error } = await supabaseBrowser()
      .rpc("ff_team_hub", { p_team_id: team.id, p_week: week });
    if (error) throw new Error(error.message);
    return data as TeamHub;
  }, [team, week]);

  const { data: hub, status, error, refetch } = useLive<TeamHub | null>(fetcher, {
    tables: ["rosters", "matchups"],
    channel: "my-team",
    pollMs: 30000,
    enabled: ready && !!team && week !== null,
  });

  const wire = useWire();

  async function drop(target: MoveTarget) {
    if (!moving || !team || week === null) return;
    if (!slotOk(target.slot, moving.position)) {
      toast("error", `A ${moving.position} can't play at ${target.slot}.`);
      return;
    }
    if (target.player?.player_id === moving.player_id) {
      setMoving(null);
      return;
    }

    // Swap: the man already in the slot takes the one being vacated.
    const assignments: Record<string, string> = { [moving.player_id]: target.slot };
    if (target.player) assignments[target.player.player_id] = moving.slot;

    setBusy(true);
    const { error: rpcError } = await supabaseBrowser().rpc("ff_set_lineup", {
      p_team_id: team.id, p_week: week, p_assignments: assignments,
    });
    setBusy(false);
    setMoving(null);
    if (rpcError) toast("error", rpcError.message);
    else toast("ok", `${moving.full_name} → ${target.slot === "BN" ? "bench" : target.slot}.`);
    await refetch();
  }

  if (!ready || (team && !hub && !error)) {
    return (
      <>
        <TopBar status={status} />
        <main className="page"><div className="card"><SkeletonRows n={10} /></div></main>
      </>
    );
  }

  if (!team || !hub) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="narrow">
          <div className="card">
            {error
              ? <div className="note" data-kind="error">Couldn&apos;t load your team: {error}</div>
              : <div className="empty">You aren&apos;t linked to a team yet.</div>}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar status={status} />
      <TeamDesk
        hub={hub}
        wire={wire}
        moving={moving}
        busy={busy}
        onPickUp={setMoving}
        onCancelMove={() => setMoving(null)}
        onDrop={drop}
        onWeek={(w) => { setMoving(null); setWeek(w); }}
      />
    </>
  );
}
