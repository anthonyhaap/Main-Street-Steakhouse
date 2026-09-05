"use client";

import { useCallback, useMemo, useState } from "react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows, useToast } from "@/components/ui";
import { Desk } from "@/components/trades/Desk";
import { BlockSheet } from "@/components/trades/BlockSheet";
import { OfferSheet } from "@/components/trades/OfferSheet";
import type { Owned } from "@/components/players/DropPicker";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TradeDesk, TradeOffer } from "@/lib/types";

export default function TradesPage() {
  const { ready, team, teams } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [offering, setOffering] = useState<{ counters?: TradeOffer } | null>(null);

  const fetcher = useCallback(async () => {
    if (!team) return null;
    const [desk, owners] = await Promise.all([
      supabaseBrowser().rpc("ff_trade_desk", { p_team_id: team.id }),
      supabaseBrowser().rpc("ff_pool_owners", { p_league_id: LEAGUE_ID }),
    ]);
    if (desk.error) throw new Error(desk.error.message);
    return { desk: desk.data as TradeDesk, owners: (owners.data ?? []) as Owned[] };
  }, [team]);

  const { data, error, refetch } = useLive(fetcher, {
    tables: ["trades", "trade_items", "trade_block", "transactions"],
    channel: "trades",
    pollMs: 60000,
    enabled: ready && !!team,
  });

  const desk = data?.desk ?? null;
  const owners = useMemo(() => data?.owners ?? [], [data]);
  const mine = useMemo(
    () => (team ? owners.filter((o) => o.team_id === team.id) : []),
    [owners, team],
  );

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

  const respond = useCallback((id: string, response: "accepted" | "declined" | "cancelled") =>
    void run(id,
      () => supabaseBrowser().rpc("ff_respond_trade", { p_trade_id: id, p_response: response }),
      response === "accepted" ? "Trade done." : response === "declined" ? "Declined." : "Withdrawn."),
  [run]);

  const skeleton = (
    <><TopBar /><main className="page" data-width="narrow">
      <div className="card"><SkeletonRows n={8} /></div>
    </main></>
  );
  if (!ready) return skeleton;
  if (!team) {
    return <><TopBar /><main className="page" data-width="narrow">
      <div className="card"><div className="empty">You need a team before you can trade.</div></div>
    </main></>;
  }
  // Said out loud rather than left as a skeleton that never resolves — see the
  // same guard on /waivers.
  if (error) {
    return <><TopBar /><main className="page" data-width="narrow">
      <div className="card">
        <div className="note" data-kind="error">Couldn&apos;t load the desk: {error}</div>
      </div>
    </main></>;
  }

  if (!desk) return skeleton;

  return (
    <>
      <TopBar />
      <main className="page" data-width="narrow">
        <Desk
          desk={desk}
          busy={busy}
          onRespond={respond}
          onCounter={(offer) => setOffering({ counters: offer })}
          onOpenBlock={() => setBlocking(true)}
          onMakeOffer={() => setOffering({})}
        />
      </main>

      {blocking && (
        <BlockSheet
          roster={mine}
          listed={desk.block.filter((b) => b.mine).map((b) => b.player_id)}
          busy={busy === "block"}
          onCancel={() => setBlocking(false)}
          onSave={(ids, note) => void run("block",
            () => supabaseBrowser().rpc("ff_set_trade_block", {
              p_team_id: team.id, p_player_ids: ids, p_note: note || null,
            }), "Block updated.").then((ok) => ok && setBlocking(false))}
        />
      )}

      {offering && (
        <OfferSheet
          myTeamId={team.id}
          teams={teams.filter((t) => t.id !== team.id).map((t) => ({ id: t.id, name: t.name }))}
          owners={owners}
          counters={offering.counters ?? null}
          busy={busy === "offer"}
          onCancel={() => setOffering(null)}
          onSubmit={(toTeamId, give, get, message, countersId) => void run("offer",
            () => supabaseBrowser().rpc("ff_propose_trade", {
              p_from_team_id: team.id, p_to_team_id: toTeamId,
              p_i_give: give, p_i_get: get,
              p_message: message || null, p_counters_id: countersId,
            }), "Offer sent.").then((ok) => ok && setOffering(null))}
        />
      )}
    </>
  );
}
