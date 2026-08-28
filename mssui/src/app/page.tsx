"use client";

import { useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock, useTicker } from "@/lib/live";
import { useSession } from "@/lib/session";
import { DRAFT_ID, LEAGUE_ID } from "@/lib/config";
import type { BoardPick, Matchup, Pulse, Standing, Team } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { Skeleton, SkeletonRows } from "@/components/ui";
import { LeagueDashboard, type Hub } from "@/components/LeagueDashboard";

export default function HomePage() {
  const { ready, team } = useSession();
  const { serverNow, synced } = useServerClock();
  useTicker(1000);

  const fetcher = useCallback(async (): Promise<Hub> => {
    const supabase = supabaseBrowser();

    // One RPC carries league state, readiness, managers, jobs and the calendar.
    const pulseRes = await supabase.rpc("ff_league_pulse", { p_league_id: LEAGUE_ID });
    if (pulseRes.error) throw pulseRes.error;
    const pulse = pulseRes.data as Pulse;
    const week = pulse.season.week ?? 1;

    const [t, r, s, m] = await Promise.all([
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
      supabase.from("draft_board").select("*").eq("draft_id", DRAFT_ID)
        .order("pick_number", { ascending: false }).limit(10),
      supabase.from("standings").select("*").eq("league_id", LEAGUE_ID),
      supabase.from("matchups").select("*").eq("league_id", LEAGUE_ID).eq("week", week),
    ]);

    return {
      pulse,
      teams: (t.data ?? []) as Team[],
      recent: (r.data ?? []) as BoardPick[],
      standings: (s.data ?? []) as Standing[],
      matchups: (m.data ?? []) as Matchup[],
    };
  }, []);

  const { data, status } = useLive<Hub>(fetcher, {
    tables: ["draft_picks", "drafts", "matchups", "teams", "challenges", "league_messages"],
    channel: "league-hub",
    pollMs: 30000,
    enabled: ready,
  });

  if (!ready || !data) return <Loading status={status} />;

  const draft = data.pulse.draft;
  const now = serverNow();
  const msLeft =
    draft?.status === "active" && draft.pick_deadline && synced
      ? new Date(draft.pick_deadline).getTime() - now
      : null;

  return (
    <>
      <TopBar status={status} />
      <LeagueDashboard data={data} myTeamId={team?.id} now={now} msLeft={msLeft} />
    </>
  );
}

function Loading({ status }: { status: ReturnType<typeof useLive>["status"] }) {
  return (
    <>
      <TopBar status={status} />
      <main className="page">
        <div className="hero"><Skeleton h={170} /></div>
        <div className="kpis">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="kpi" key={i}><Skeleton h={62} /></div>
          ))}
        </div>
        <div className="dash">
          <div className="dash__col">
            <div className="card"><SkeletonRows n={6} /></div>
            <div className="card"><SkeletonRows n={4} /></div>
          </div>
          <div className="dash__col">
            <div className="card"><SkeletonRows n={6} /></div>
            <div className="card"><SkeletonRows n={4} /></div>
          </div>
        </div>
      </main>
    </>
  );
}
