"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useCrests, useSession } from "@/lib/session";
import { useWire } from "@/lib/nfl/wire";
import type { HubPlayer, TeamHub } from "@/lib/nfl/types";
import { TopBar } from "@/components/Shell";
import { SkeletonRows, useToast } from "@/components/ui";
import { TeamDesk, slotOk, type MoveTarget } from "@/components/team/TeamDesk";
import { EditTeam } from "@/components/team/EditTeam";

export default function TeamPage() {
  const { ready, team, reload } = useSession();
  const crestOf = useCrests();
  const toast = useToast();
  const [week, setWeek] = useState<number | null>(null);
  const [moving, setMoving] = useState<HubPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

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

  const { data: wire } = useWire(ready);

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
        crest={crestOf(team.id)}
        oppCrest={crestOf(hub.matchup?.opponent.id)}
        onPickUp={setMoving}
        onCancelMove={() => setMoving(null)}
        onDrop={drop}
        onWeek={(w) => { setMoving(null); setWeek(w); }}
        onEdit={() => setEditing(true)}
      />
      {editing && (
        <EditTeam
          team={team}
          onClose={() => setEditing(false)}
          // The name and the crest are on every screen in the app, so the whole
          // session is reloaded rather than just this page's hub.
          onSaved={async () => { await reload(); await refetch(); }}
        />
      )}
    </>
  );
}
