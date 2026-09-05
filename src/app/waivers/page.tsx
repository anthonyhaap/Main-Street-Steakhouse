"use client";

import { useCallback, useMemo, useState } from "react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows, useToast } from "@/components/ui";
import { ClaimSheet } from "@/components/waivers/ClaimSheet";
import { Wire } from "@/components/waivers/Wire";
import type { Owned } from "@/components/players/DropPicker";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { WaiverBoard, WaiverPlayer } from "@/lib/types";

export default function WaiversPage() {
  const { ready, team } = useSession();
  const toast = useToast();
  const [claiming, setClaiming] = useState<WaiverPlayer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    if (!team) return null;
    const [board, owners] = await Promise.all([
      supabaseBrowser().rpc("ff_waiver_board", { p_team_id: team.id }),
      supabaseBrowser().rpc("ff_pool_owners", { p_league_id: LEAGUE_ID }),
    ]);
    if (board.error) throw new Error(board.error.message);
    return {
      board: board.data as WaiverBoard,
      roster: ((owners.data ?? []) as Owned[]).filter((o) => o.team_id === team.id),
    };
  }, [team]);

  const { data, error, refetch } = useLive(fetcher, {
    tables: ["waiver_claims", "waiver_runs", "transactions"],
    channel: "waivers",
    pollMs: 60000,
    enabled: ready && !!team,
  });

  const board = data?.board ?? null;
  const roster = useMemo(() => data?.roster ?? [], [data]);

  const run = useCallback(async (
    key: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    ok: string,
  ) => {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) { toast("error", error.message); return false; }
    toast("ok", ok);
    await refetch();
    return true;
  }, [toast, refetch]);

  const claim = useCallback(async (dropId: string | null) => {
    if (!team || !claiming) return;
    const done = await run(
      claiming.player_id,
      () => supabaseBrowser().rpc("ff_claim_waiver", {
        p_team_id: team.id,
        p_add_player_id: claiming.player_id,
        p_drop_player_id: dropId,
        p_claim_order: null,
      }),
      `Claim in for ${claiming.player}.`,
    );
    if (done) setClaiming(null);
  }, [team, claiming, run]);

  /** Reordering is the whole point of a priority queue: the run gives a manager
   *  at most one claim per pass, so which one is first decides what he gets. */
  const move = useCallback((index: number, by: -1 | 1) => {
    if (!team || !board) return;
    const ids = board.my_claims.map((c) => c.claim_id);
    const to = index + by;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void run(ids[to], () => supabaseBrowser().rpc("ff_order_waiver_claims", {
      p_team_id: team.id, p_claim_ids: ids,
    }), "Order changed.");
  }, [team, board, run]);

  const skeleton = (
    <><TopBar /><main className="page" data-width="narrow">
      <div className="card"><SkeletonRows n={8} /></div>
    </main></>
  );

  if (!ready) return skeleton;

  // Checked before the board, not after: a signed-in account with no team gets
  // a sentence rather than a skeleton that never resolves.
  if (!team) {
    return <><TopBar /><main className="page" data-width="narrow">
      <div className="card"><div className="empty">You need a team before you can claim anybody.</div></div>
    </main></>;
  }

  // A board that will not load is said out loud rather than left as a skeleton
  // that never resolves. The likeliest cause is the waivers migration not being
  // applied yet, and a manager staring at a spinner cannot tell that from a slow
  // network.
  if (error) {
    return <><TopBar /><main className="page" data-width="narrow">
      <div className="card">
        <div className="note" data-kind="error">Couldn&apos;t load the wire: {error}</div>
      </div>
    </main></>;
  }

  if (!board) return skeleton;

  const claimedIds = new Set(board?.my_claims.map((c) => c.add_player_id) ?? []);

  return (
    <>
      <TopBar />
      <main className="page" data-width="narrow">
        <Wire
          board={board}
          teamName={team.name}
          busy={busy}
          claimed={claimedIds}
          onClaim={setClaiming}
          onCancelClaim={(id, name) => void run(id,
            () => supabaseBrowser().rpc("ff_cancel_waiver_claim", { p_claim_id: id }),
            `Claim on ${name} withdrawn.`)}
          onMove={move}
        />
      </main>

      {claiming && (
        <ClaimSheet
          player={{ id: claiming.player_id, name: claiming.player }}
          roster={roster}
          settlesAt={board?.settles_at ?? null}
          busy={busy === claiming.player_id}
          onCancel={() => setClaiming(null)}
          onSubmit={(dropId) => void claim(dropId)}
        />
      )}
    </>
  );
}
