"use client";

import { useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useCrests, useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { Outlook } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { StandingsBoard } from "@/components/StandingsBoard";

export default function StandingsPage() {
  const { ready, team } = useSession();
  const crestOf = useCrests();

  // One RPC carries the table, the whole schedule and each lineup's projected
  // output; the playoff simulation runs on the phone from there.
  const fetcher = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("ff_playoff_outlook", { p_league_id: LEAGUE_ID });
    if (error) throw error;
    return data as Outlook;
  }, []);

  const { data, status } = useLive<Outlook>(fetcher, {
    tables: ["matchups", "teams", "rosters"], channel: "standings", pollMs: 60000, enabled: ready,
  });

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="mid">
        <StandingsBoard outlook={data} myTeamId={team?.id} crestOf={crestOf} />
      </main>
    </>
  );
}
