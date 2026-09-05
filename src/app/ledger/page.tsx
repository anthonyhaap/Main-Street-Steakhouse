"use client";

import { useCallback, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { LedgerEntry } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { Ledger, type LedgerFilter } from "@/components/ledger/Ledger";

/**
 * The league's transaction history.
 *
 * ff_transactions has existed since add/drop shipped with nothing reading it,
 * which meant three systems could move players around and leave no visible
 * account of it. This is that account.
 *
 * The whole window is fetched once and filtered in the browser. That is the
 * right trade at this size — a twelve-team league is a few hundred moves a
 * season, and it makes the filters instant rather than a round trip each. The
 * server caps at 200 regardless; when a league can genuinely exceed that in a
 * season, this wants a cursor rather than a bigger number.
 */
export default function LedgerPage() {
  const { ready } = useSession();
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [team, setTeam] = useState("");

  const fetcher = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .rpc("ff_transactions", { p_league_id: LEAGUE_ID, p_limit: 200 });
    if (error) throw new Error(error.message);
    return (data ?? []) as LedgerEntry[];
  }, []);

  const { data, error, status } = useLive<LedgerEntry[]>(fetcher, {
    tables: ["transactions"],
    channel: "ledger",
    pollMs: 60000,
    enabled: ready,
  });

  // Every team that appears anywhere in the window, so the filter offers the
  // clubs that actually have history rather than a list from somewhere else.
  const teams = useMemo(() => {
    const seen = new Set<string>();
    for (const e of data ?? []) {
      for (const i of e.items) {
        if (i.from_team) seen.add(i.from_team);
        if (i.to_team) seen.add(i.to_team);
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [data]);

  if (!ready || (!data && !error)) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="narrow">
          <div className="card"><SkeletonRows n={8} /></div>
        </main>
      </>
    );
  }

  // Said out loud rather than left as a skeleton that never resolves — the same
  // guard /waivers and /trades carry.
  if (error) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="narrow">
          <div className="card">
            <div className="note" data-kind="error">Couldn&apos;t load the ledger: {error}</div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="narrow">
        <Ledger
          entries={data ?? []}
          filter={filter}
          team={team}
          teams={teams}
          onFilter={setFilter}
          onTeam={setTeam}
        />
      </main>
    </>
  );
}
