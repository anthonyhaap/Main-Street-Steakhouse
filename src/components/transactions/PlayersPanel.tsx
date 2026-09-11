"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { PoolPlayer } from "@/lib/types";
import { useToast } from "@/components/ui";
import type { Owned } from "@/components/players/DropPicker";
import { Pool, type SignResult } from "@/components/players/Pool";

/**
 * The player pool, wired up: the first tab of the transaction centre, because
 * it is the one every other tab begins at — you sign, claim or trade a name
 * you found here.
 *
 * This owns the fetching and the RPCs. What the list looks like and what it
 * offers is `Pool`, which is also what /preview/players renders from a
 * fixture, so the sentences and the buttons can be asserted without a session.
 */
export function PlayersPanel() {
  const { ready, team } = useSession();
  const toast = useToast();
  const [pool, setPool] = useState<PoolPlayer[] | null>(null);
  const [owners, setOwners] = useState<Owned[]>([]);
  const [week, setWeek] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waivers, setWaivers] = useState<Map<string, string>>(new Map());

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
      // Ownership lands before the pool does, on purpose. The list opens on the
      // available players, and "available" is decided against the owners; a
      // pool rendered a beat before them would show every drafted player as
      // signable and then take them all away.
      const [p, w] = await Promise.all([
        supabase.from("draft_pool").select("*")
          .order("overall_rank", { ascending: true, nullsFirst: false }).range(0, 2499),
        supabase.rpc("ff_current_week"),
        loadOwners(),
      ]);
      setWeek((w.data as number) ?? 1);
      setPool((p.data ?? []) as PoolPlayer[]);
    })();
  }, [ready, loadOwners]);

  /**
   * Sign a free agent, dropping someone in the same move when one is named.
   *
   * A bare add onto a full roster is refused by the database rather than
   * guessed at here: the cap is the league's, the count is derived, and a
   * browser that decided for itself would be wrong the moment another manager
   * moved first. The refusal is what opens the picker.
   */
  const sign = useCallback(async (add: PoolPlayer, dropId?: string): Promise<SignResult> => {
    if (!team) return "failed";
    setBusy(add.id);
    const { data, error } = await supabaseBrowser().rpc("ff_add_drop", {
      p_team_id: team.id,
      p_add_player_id: add.id,
      p_drop_player_id: dropId ?? null,
      p_week: week,
    });
    setBusy(null);

    if (error) {
      if (/roster is full/i.test(error.message)) return "full";
      toast("error", error.message);
      return "failed";
    }
    const gone = (data as { dropped?: string } | null)?.dropped;
    toast("ok", gone ? `${add.full_name} in, ${gone} out.` : `${add.full_name} is yours.`);
    await loadOwners();
    return "done";
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
    if (error) { toast("error", error.message); return; }
    toast("ok", `${name} is back in the pool.`);
    await loadOwners();
  }, [team, week, toast, loadOwners]);

  /** File a claim from the pool, rather than sending the manager elsewhere. */
  const claim = useCallback(async (add: PoolPlayer, dropId: string | null) => {
    if (!team) return false;
    setBusy(add.id);
    const { error } = await supabaseBrowser().rpc("ff_claim_waiver", {
      p_team_id: team.id,
      p_add_player_id: add.id,
      p_drop_player_id: dropId,
      p_claim_order: null,
    });
    setBusy(null);
    if (error) { toast("error", error.message); return false; }
    toast("ok", `Claim in for ${add.full_name}.`);
    await loadOwners();
    return true;
  }, [team, toast, loadOwners]);

  return (
    <Pool
      pool={pool}
      owners={owners}
      waivers={waivers}
      teamId={team?.id ?? null}
      busy={busy}
      onSign={sign}
      onRelease={release}
      onClaim={claim}
    />
  );
}
