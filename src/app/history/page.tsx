"use client";

import { useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { HistoricalStanding, History } from "@/lib/history";
import { TopBar } from "@/components/Shell";
import { HistoryWall } from "@/components/history/HistoryWall";

export default function HistoryPage() {
  const { ready, team, isCommissioner } = useSession();

  const fetcher = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("ff_history", { p_league_id: LEAGUE_ID });
    if (error) throw new Error(error.message);
    return data as History;
  }, []);

  const { data, status, error } = useLive<History>(fetcher, {
    tables: ["matchups", "league_history", "teams"], channel: "history", pollMs: 120000, enabled: ready,
  });

  const standingsFetcher = useCallback(async () => {
    const { data: rows, error: standingsError } = await supabaseBrowser()
      .from("historical_standings")
      .select("season,final_rank,team_name,manager_names,wins,losses,ties,points_for,points_against,moves")
      .eq("league_id", LEAGUE_ID)
      .order("season", { ascending: false })
      .order("final_rank", { ascending: true });
    if (standingsError) throw new Error(standingsError.message);
    return rows as HistoricalStanding[];
  }, []);

  const { data: historicalStandings } = useLive<HistoricalStanding[]>(standingsFetcher, {
    tables: ["historical_standings"], channel: "historical-standings", pollMs: 120000, enabled: ready,
  });

  return (
    <>
      <TopBar status={status} />
      {error && !data ? (
        <main className="page">
          <div className="card"><div className="note" data-kind="error">Couldn&apos;t open the wall: {error}</div></div>
        </main>
      ) : (
        <HistoryWall
          history={data}
          historicalStandings={historicalStandings ?? []}
          myManager={team ? (team.manager_name ?? team.name) : null}
          importable={isCommissioner}
        />
      )}
    </>
  );
}
