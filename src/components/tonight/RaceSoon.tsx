"use client";

import { useCallback, useMemo } from "react";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { oddsCanSeparate, playoffRace } from "@/lib/playoffs";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Outlook } from "@/lib/types";
import { RaceLine } from "@/components/standings/Race";

/**
 * The playoff race in a line on the front page: your odds now, with a win and
 * with a loss this week, and the other result to root for.
 *
 * Only while the race is open for you — a team that has clinched or is out has
 * no news here, and the full picture is a tap away on the standings. The same
 * outlook call the standings page makes; the simulation runs on the phone.
 */
export function RaceSoon({ teamId, enabled }: { teamId: string; enabled: boolean }) {
  const fetcher = useCallback(async (): Promise<Outlook | null> => {
    const { data, error } = await supabaseBrowser().rpc("ff_playoff_outlook", { p_league_id: LEAGUE_ID });
    // A front-page extra: no answer means no line, not a broken page.
    if (error) return null;
    return data as Outlook;
  }, []);

  const { data } = useLive<Outlook | null>(fetcher, {
    tables: ["matchups", "teams"],
    channel: "tonight-race",
    pollMs: 5 * 60_000,
    enabled,
  });

  const race = useMemo(() => (data && oddsCanSeparate(data) ? playoffRace(data) : null), [data]);
  if (!data || !race) return null;
  return <RaceLine race={race} outlook={data} myTeamId={teamId} />;
}
