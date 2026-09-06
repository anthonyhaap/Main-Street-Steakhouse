"use client";

import { FormEvent, useCallback, useState } from "react";
import { Send } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { FeedItem, HouseFeed } from "@/lib/types";
import { House, type HouseFilter } from "@/components/house/House";

/**
 * The House.
 *
 * This was the clubhouse, and it read `league_messages` directly. It is now one
 * merged stream: what managers said and what the league did, newest first.
 *
 * The merge is the point. `activity_events` had been written by four migrations
 * — every signing, every settled waiver, every accepted trade — and rendered
 * nowhere except a four-item summary on the front page. A trade going through
 * is the most talked-about thing that happens in a fantasy league, and it was
 * happening somewhere nobody was looking, while the room where everyone talks
 * had no idea it had occurred.
 *
 * It stays at /chat and keeps its place in the nav rather than becoming a
 * thirteenth destination. The old file's own comment argued that a league of
 * twelve cannot afford a conversation only two people ever see; a separate feed
 * screen would have split the room in exactly that way.
 */
export default function HousePage() {
  const { ready } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HouseFilter>("all");

  // Pages fetched beyond the first. Kept apart from the live head so that a
  // refetch — a poll, a realtime nudge — refreshes the top of the feed without
  // throwing away what the manager has already scrolled past.
  const [older, setOlder] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetcher = useCallback(async (): Promise<HouseFeed> => {
    const { data, error: rpcError } = await supabaseBrowser()
      .rpc("ff_house_feed", { p_league_id: LEAGUE_ID, p_limit: 40 });
    if (rpcError) throw new Error(rpcError.message);
    return data as HouseFeed;
  }, []);

  const { data, status, error: feedError, refetch } = useLive<HouseFeed>(fetcher, {
    tables: ["league_messages", "activity_events"],
    channel: "house",
    pollMs: 30000,
    enabled: ready,
  });

  async function loadMore() {
    const from = cursor ?? data?.next_before ?? null;
    if (!from || loadingMore) return;
    setLoadingMore(true);
    const { data: page } = await supabaseBrowser()
      .rpc("ff_house_feed", { p_league_id: LEAGUE_ID, p_before: from, p_limit: 40 });
    setLoadingMore(false);
    if (!page) return;
    const next = page as HouseFeed;
    setOlder((prev) => [...prev, ...next.items]);
    setCursor(next.next_before);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const { error: sendError } = await supabaseBrowser()
      .rpc("ff_send_message", { p_league_id: LEAGUE_ID, p_body: value });
    setBusy(false);
    if (sendError) return setError(sendError.message);
    setBody("");
    await refetch();
  }

  const items = [...(data?.items ?? []), ...older];
  const hasMore = (cursor ?? data?.next_before ?? null) !== null;

  return (
    <>
      <TopBar status={status} />
      <main className="page">
        <header style={{ marginBottom: "var(--s5)" }}>
          <div className="eyebrow" data-tone="gold">The House</div>
          <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "var(--s2) 0" }}>
            Everything, as it happens.
          </h1>
          <p className="prose">
            Signings, waiver results and trades land here on their own, next to
            whatever the league has to say about them. Anything said on a matchup
            card shows up too, with the game it was said about.
          </p>
        </header>

        {/* The composer sits above the feed because the feed is newest-first:
            what you write appears where you are already looking. */}
        <form
          onSubmit={send}
          style={{ display: "flex", gap: "var(--s2)", marginBottom: "var(--s4)" }}
        >
          <input
            className="field"
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say something to the league…"
            aria-label="Say something to the league"
          />
          <button
            className="btn"
            data-v="primary"
            data-size="icon"
            disabled={busy || !body.trim()}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </form>

        {error && <div className="note" data-kind="error" style={{ marginBottom: "var(--s4)" }}>{error}</div>}

        {feedError ? (
          <div className="card">
            <div className="note" data-kind="error">Couldn&apos;t load the House: {feedError}</div>
          </div>
        ) : !data ? (
          <div className="card"><SkeletonRows n={6} /></div>
        ) : (
          <House
            items={items}
            filter={filter}
            onFilter={setFilter}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onMore={() => void loadMore()}
          />
        )}
      </main>
    </>
  );
}
