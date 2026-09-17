"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LEAGUE_ID, SEASON } from "@/lib/config";
import type { PickemSeasonStanding, PickemWeek, PickemWeeklyStanding } from "@/lib/pickem/types";
import { PickemHeader } from "@/components/pickem/PickemHeader";
import { GameCard } from "@/components/pickem/GameCard";
import { WeeklyStandings, SeasonStandings, WeeklyChampionCard } from "@/components/pickem/PickemStandings";

/** The regular season, wall to wall. Picking ahead is allowed — each game
    still locks at its own kickoff regardless of which week it's filed under. */
const REGULAR_SEASON_WEEKS = 18;

const TABS = [
  { key: "board", label: "The Board" },
  { key: "weekly", label: "Weekly Standings" },
  { key: "season", label: "Season Standings" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function PickemPage() {
  const { ready } = useSession();
  const [week, setWeek] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [busyGame, setBusyGame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open on the week ff_current_week says matters right now, then leave the
  // choice to the manager — switching weeks never refetches this.
  useEffect(() => {
    if (!ready || week !== null) return;
    void supabaseBrowser().rpc("ff_current_week").then(({ data }) => {
      if (typeof data === "number") setWeek(data);
    });
  }, [ready, week]);

  const boardFetcher = useCallback(async (): Promise<PickemWeek | null> => {
    if (week === null) return null;
    const { data, error: rpcError } = await supabaseBrowser().rpc("ff_pickem_week", {
      p_league_id: LEAGUE_ID, p_season: SEASON, p_week: week,
    });
    if (rpcError) throw rpcError;
    return data as PickemWeek;
  }, [week]);
  const { data: board, status, error: boardError, refetch: refetchBoard } = useLive<PickemWeek | null>(boardFetcher, {
    tables: ["pickem_picks", "nfl_games"], channel: `pickem-board-${week ?? 0}`, pollMs: 20000, enabled: ready && week !== null,
  });

  const standingsFetcher = useCallback(async (): Promise<{ current: PickemWeeklyStanding[]; previous: PickemWeeklyStanding[] }> => {
    if (week === null) return { current: [], previous: [] };
    const [cur, prev] = await Promise.all([
      supabaseBrowser().rpc("ff_pickem_weekly_standings", { p_league_id: LEAGUE_ID, p_season: SEASON, p_week: week }),
      week > 1
        ? supabaseBrowser().rpc("ff_pickem_weekly_standings", { p_league_id: LEAGUE_ID, p_season: SEASON, p_week: week - 1 })
        : Promise.resolve({ data: [] as PickemWeeklyStanding[], error: null }),
    ]);
    if (cur.error) throw cur.error;
    if (prev.error) throw prev.error;
    return { current: (cur.data as PickemWeeklyStanding[]) ?? [], previous: (prev.data as PickemWeeklyStanding[]) ?? [] };
  }, [week]);
  const { data: standings, error: standingsError } = useLive<{ current: PickemWeeklyStanding[]; previous: PickemWeeklyStanding[] }>(standingsFetcher, {
    tables: ["pickem_picks", "nfl_games"], channel: `pickem-standings-${week ?? 0}`, pollMs: 30000, enabled: ready && week !== null,
  });

  const seasonFetcher = useCallback(async (): Promise<PickemSeasonStanding[]> => {
    const { data, error: rpcError } = await supabaseBrowser().rpc("ff_pickem_season_standings", {
      p_league_id: LEAGUE_ID, p_season: SEASON,
    });
    if (rpcError) throw rpcError;
    return (data as PickemSeasonStanding[]) ?? [];
  }, []);
  const { data: season, error: seasonError } = useLive<PickemSeasonStanding[]>(seasonFetcher, {
    tables: ["pickem_picks", "nfl_games"], channel: "pickem-season", pollMs: 60000, enabled: ready,
  });

  // Any of the three reads failing (most likely: the database hasn't caught
  // up with the code yet) should say so, not spin the skeleton forever.
  const loadError = boardError ?? standingsError ?? seasonError;

  const myWeekly = standings?.current.find((r) => r.mine);
  const mySeason = season?.find((r) => r.mine);
  const picksRemaining = useMemo(
    () => board?.games.filter((g) => !g.locked && !g.my_pick).length ?? 0,
    [board],
  );
  const weekComplete = board !== null && board !== undefined && board.games.length > 0
    && board.games.every((g) => g.status === "post");
  const currentStandings = standings?.current;
  const champions = useMemo(() => {
    if (!weekComplete || !currentStandings?.length) return [];
    const top = currentStandings[0].correct;
    if (top === 0) return [];
    return currentStandings.filter((r) => r.correct === top && r.rank === 1);
  }, [weekComplete, currentStandings]);

  const makePick = async (gameId: string, teamAbbr: string) => {
    setBusyGame(gameId);
    setError(null);
    const { error: rpcError } = await supabaseBrowser().rpc("ff_make_pick", {
      p_league_id: LEAGUE_ID, p_game_id: gameId, p_team: teamAbbr,
    });
    setBusyGame(null);
    if (rpcError) { setError(rpcError.message); return; }
    await refetchBoard();
  };

  return (
    <>
      <TopBar status={status} />
      <main className="page">
        <PickemHeader
          week={week}
          weekCount={REGULAR_SEASON_WEEKS}
          onWeekChange={setWeek}
          thisWeek={myWeekly}
          season={mySeason}
          picksRemaining={picksRemaining}
        />

        <div className="segmented" style={{ margin: "var(--s5) 0" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="segmented__opt"
              data-on={tab === t.key}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p role="alert" style={{ color: "var(--lose)" }}>{error}</p>}
        {!error && loadError && (
          <p role="alert" style={{ color: "var(--lose)" }}>
            Couldn&apos;t load Pick&apos;em: {loadError}
          </p>
        )}

        {tab === "board" && (
          !board ? (
            boardError ? null : <div className="card"><SkeletonRows n={6} /></div>
          ) : board.games.length === 0 ? (
            <div className="card"><div className="empty">No games scheduled for week {week}.</div></div>
          ) : (
            <>
              {champions.length > 0 && week !== null && <WeeklyChampionCard week={week} champions={champions} />}
              <div className="grid-auto">
                {board.games.map((g) => (
                  <GameCard
                    key={g.game_id}
                    game={g}
                    members={board.members}
                    busy={busyGame === g.game_id}
                    onPick={(teamAbbr) => void makePick(g.game_id, teamAbbr)}
                  />
                ))}
              </div>
            </>
          )
        )}

        {tab === "weekly" && (
          <WeeklyStandings rows={standings?.current ?? null} previous={standings?.previous ?? null} loading={!standings && !standingsError} />
        )}

        {tab === "season" && <SeasonStandings rows={season ?? null} loading={!season && !seasonError} />}
      </main>
    </>
  );
}
