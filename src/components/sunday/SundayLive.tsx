"use client";

/**
 * The live game center: `GameCenter` under the app's live contract.
 *
 * Nobody's browser talks to ESPN or Sleeper. `pg_cron` polls them every two
 * minutes during a game window, writes the stat lines and the NFL games once,
 * and every connected phone learns about it from a realtime row change — as a
 * signal to refetch one aggregated call, never as the data. So twelve managers
 * with the page open all afternoon cost the providers exactly nothing more
 * than one manager does.
 *
 * When the numbers stop — the provider is down, the socket dropped, the fetch
 * failed — the page keeps what it has on screen, says the stats are delayed,
 * and picks up again on the next successful refetch. The chat keeps working
 * through all of it; it is a separate call on purpose.
 */

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock } from "@/lib/live";
import { useSession } from "@/lib/session";
import { LEAGUE_ID } from "@/lib/config";
import { delayed, type SundayBoard } from "@/lib/sunday";
import { loadSunday } from "@/lib/sunday-load";
import type { ChatFeed } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { GameCenter, GameCenterSkeleton } from "./GameCenter";

export function SundayLive({ initial, week }: { initial: SundayBoard | null; week: number | null }) {
  const { ready } = useSession();

  // Fifteen seconds while a game is on, a minute when none is. Realtime does
  // the real work; the poll is the net under it.
  const [hot, setHot] = useState((initial?.games?.in_progress ?? 0) > 0);

  const fetcher = useCallback(async (): Promise<SundayBoard> => {
    const b = await loadSunday(supabaseBrowser(), week);
    setHot((b.games?.in_progress ?? 0) > 0);
    return b;
  }, [week]);

  const { data, status, error, refetch } = useLive<SundayBoard>(fetcher, {
    tables: ["matchups", "rosters", "nfl_games"],
    channel: "sunday",
    pollMs: hot ? 15000 : 60000,
    enabled: ready,
    initial,
  });

  const chatFetcher = useCallback(async (): Promise<ChatFeed> => {
    const { data: feed, error: e } = await supabaseBrowser()
      .rpc("ff_chat_feed", { p_league_id: LEAGUE_ID, p_limit: 30 });
    if (e) throw new Error(e.message);
    return feed as ChatFeed;
  }, []);

  const chat = useLive<ChatFeed>(chatFetcher, {
    tables: ["league_messages", "reactions"],
    channel: "sunday-chat",
    pollMs: 45000,
    enabled: ready,
  });

  const [chatError, setChatError] = useState<string | null>(null);
  const send = useCallback(async (body: string) => {
    setChatError(null);
    const { error: e } = await supabaseBrowser().rpc("ff_send_message", {
      p_league_id: LEAGUE_ID, p_body: body, p_parent_id: null, p_mentions: null,
    });
    if (e) {
      setChatError(e.message);
      throw new Error(e.message);
    }
    await chat.refetch();
  }, [chat]);

  // Server time, the same as every clock in the app.
  const { serverNow, synced } = useServerClock();
  const [now, setNow] = useState(() => (initial ? new Date(initial.now).getTime() : 0));
  useEffect(() => {
    const tick = () => setNow(synced ? serverNow() : Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [synced, serverNow]);

  const board = data;
  const clock = now || (board ? new Date(board.now).getTime() : 0);

  return (
    <>
      <TopBar status={status} />
      {!board && !error && <GameCenterSkeleton />}
      {!board && error && (
        <div className="sun" data-desk="center" data-mob="feed">
          <div className="sun-quiet" style={{ display: "grid", gap: "var(--s3)", justifyItems: "start" }}>
            The game center didn&apos;t load. {error}
            <button className="sun-btn" onClick={() => void refetch()}>Try again</button>
          </div>
        </div>
      )}
      {board && (
        <GameCenter
          board={board}
          now={clock}
          delayed={delayed(board, clock, !!error)}
          chat={chat.data?.items ?? null}
          onSend={send}
          chatError={chatError ?? chat.error}
        />
      )}
    </>
  );
}
