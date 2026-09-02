"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import type { Matchup, RosterPoint, Team } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { Scoreboard } from "@/components/Scoreboard";

type Board = { matchups: Matchup[]; points: RosterPoint[]; teams: Team[] };

export default function MatchupsPage() {
  const { ready, team, league } = useSession();
  const [week, setWeek] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    void supabaseBrowser().rpc("ff_current_week").then(({ data }) => setWeek((data as number) ?? 1));
  }, [ready]);

  const fetcher = useCallback(async (): Promise<Board> => {
    const supabase = supabaseBrowser();
    const [m, p, t] = await Promise.all([
      supabase.from("matchups").select("*").eq("league_id", LEAGUE_ID).eq("week", week!),
      supabase.from("roster_points").select("*").eq("league_id", LEAGUE_ID).eq("week", week!),
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
    ]);
    return {
      matchups: (m.data ?? []) as Matchup[],
      points: (p.data ?? []) as RosterPoint[],
      teams: (t.data ?? []) as Team[],
    };
  }, [week]);

  const { data, status } = useLive<Board>(fetcher, {
    tables: ["matchups", "rosters"],
    channel: "scoreboard",
    pollMs: 20000,
    enabled: ready && week !== null,
  });

  const weeks = Number((league?.settings as { regular_season_weeks?: number })?.regular_season_weeks ?? 14) + 3;

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-width="mid">
        <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
              <button key={w} className="segmented__opt num" data-on={w === week} onClick={() => setWeek(w)}>
                {w}
              </button>
            ))}
          </div>
        </div>

        {!data && <div className="card"><SkeletonRows n={6} /></div>}
        {data?.matchups.length === 0 && (
          <div className="card"><div className="empty">No matchups for week {week} yet.<br />The schedule posts after the draft.</div></div>
        )}

        {data && data.matchups.length > 0 && (
          <Scoreboard
            matchups={data.matchups}
            points={data.points}
            teams={data.teams}
            myTeamId={team?.id ?? null}
          />
        )}
      </main>
    </>
  );
}
