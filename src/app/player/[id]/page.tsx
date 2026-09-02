"use client";

import { use, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import type { PlayerCard } from "@/lib/nfl/types";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { PlayerPage } from "@/components/player/PlayerPage";

/**
 * /player/[id] — one player, everything we know.
 *
 * A location rather than a modal, so a card can be opened in a new tab, pasted
 * into the league chat and reached with the back button. `ff_player_card`
 * assembles it in one round trip; this page is the session, the loading state
 * and the live contract around that call.
 */
export default function PlayerRoute({ params }: PageProps<"/player/[id]">) {
  const { id } = use(params);
  const { ready } = useSession();

  const fetcher = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("ff_player_card", { p_player_id: id });
    if (error) throw new Error(error.message);
    return data as PlayerCard;
  }, [id]);

  const { data: card, status, error } = useLive<PlayerCard>(fetcher, {
    // A live stat line or a fresh injury report should reach an open card.
    tables: ["player_stat_lines", "nfl_injuries", "rosters"],
    channel: `player-${id}`,
    pollMs: 60000,
    enabled: ready,
  });

  if (error) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="narrow">
          <div className="card">
            <div className="note" data-kind="error">Couldn&apos;t load this player: {error}</div>
          </div>
        </main>
      </>
    );
  }

  if (!card) {
    return (
      <>
        <TopBar status={status} />
        <main className="page" data-width="mid">
          <div className="card"><SkeletonRows n={8} /></div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar status={status} />
      <PlayerPage card={card} />
    </>
  );
}
