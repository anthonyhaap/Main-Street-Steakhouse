"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { markSeen } from "@/lib/unread";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LeagueFeed as LeagueFeedData, LeagueFeedItem } from "@/lib/types";
import { LeagueFeed } from "@/components/league-feed/LeagueFeed";

/**
 * The League Feed.
 *
 * The record: signings, waiver runs, trades, commissioner announcements and
 * the weekly Sunday Live thread, newest first. Read-mostly, on purpose — this
 * is what a manager opens to find out what happened, not to talk about it.
 * Talk lives at /chat.
 */
export default function LeagueFeedPage() {
  const { ready, isCommissioner } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unpinning, setUnpinning] = useState<string | null>(null);

  const [announcing, setAnnouncing] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const [older, setOlder] = useState<LeagueFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null);

  useEffect(() => {
    if (ready) void markSeen("league_feed");
  }, [ready]);

  const fetcher = useCallback(async (): Promise<LeagueFeedData> => {
    const { data, error: rpcError } = await supabaseBrowser()
      .rpc("ff_league_feed", { p_league_id: LEAGUE_ID, p_limit: 40 });
    if (rpcError) throw new Error(rpcError.message);
    return data as LeagueFeedData;
  }, []);

  const { data, status, error: feedError, refetch, mutate } = useLive<LeagueFeedData>(fetcher, {
    tables: ["league_messages", "activity_events", "reactions"],
    channel: "league-feed",
    pollMs: 30000,
    enabled: ready,
  });

  async function loadMore() {
    const from = cursor ?? data?.next_before ?? null;
    if (!from || loadingMore) return;
    setLoadingMore(true);
    const { data: page } = await supabaseBrowser()
      .rpc("ff_league_feed", { p_league_id: LEAGUE_ID, p_before: from, p_limit: 40 });
    setLoadingMore(false);
    if (!page) return;
    const next = page as LeagueFeedData;
    setOlder((prev) => [...prev, ...next.items]);
    setCursor(next.next_before);
  }

  async function react(item: LeagueFeedItem, emoji: string) {
    const key = `${item.source}:${item.id}`;
    setReacting(key);

    const bump = (list: LeagueFeedItem[]) => list.map((f) => {
      if (f.id !== item.id || f.source !== item.source) return f;
      const existing = (f.reactions ?? []).find((r) => r.emoji === emoji);
      const next = existing
        ? (f.reactions ?? [])
            .map((r) => r.emoji === emoji
              ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine }
              : r)
            .filter((r) => r.count > 0)
        : [...(f.reactions ?? []), { emoji, count: 1, mine: true }];
      return { ...f, reactions: next };
    });
    setOlder(bump);
    mutate(data ? { ...data, items: bump(data.items) } : data);

    const { error: rpcError } = await supabaseBrowser().rpc("ff_react", {
      p_league_id: LEAGUE_ID, p_source: item.source, p_target_id: item.id, p_emoji: emoji,
    });
    setReacting(null);
    if (rpcError) setError(rpcError.message);
    await refetch();
  }

  async function announce(event: FormEvent) {
    event.preventDefault();
    const value = announcement.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabaseBrowser()
      .rpc("ff_post_announcement", { p_league_id: LEAGUE_ID, p_body: value });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setAnnouncement("");
    setAnnouncing(false);
    await refetch();
  }

  async function unpin(item: LeagueFeedItem) {
    setUnpinning(item.id);
    const { error: rpcError } = await supabaseBrowser()
      .rpc("ff_set_announcement_pinned", { p_message_id: item.id, p_pinned: false });
    setUnpinning(null);
    if (rpcError) setError(rpcError.message);
    await refetch();
  }

  const items = [...(data?.items ?? []), ...older];
  const hasMore = (cursor ?? data?.next_before ?? null) !== null;

  return (
    <>
      <TopBar status={status} />
      <main className="page">
        <header style={{ marginBottom: "var(--s5)" }}>
          <div className="eyebrow" data-tone="gold">League Feed</div>
          <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "var(--s2) 0" }}>
            Everything, as it happens.
          </h1>
          <p className="prose">
            Signings, waiver results, trades and league news land here on
            their own. To talk about any of it, head to Chat.
          </p>
        </header>

        {isCommissioner && (announcing ? (
          <form onSubmit={announce} className="card" style={{ marginBottom: "var(--s4)" }}>
            <div className="card__head">
              <h2>Post an announcement</h2>
              <button type="button" className="btn" data-size="icon" aria-label="Cancel"
                onClick={() => setAnnouncing(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 8 }}>
              <input className="field" maxLength={500} value={announcement} autoFocus
                placeholder="The draft moves to Thursday at 8pm." aria-label="Your announcement"
                onChange={(e) => setAnnouncement(e.target.value)} />
              <button className="btn" data-v="primary" style={{ marginLeft: "auto" }}
                disabled={busy || !announcement.trim()}>
                {busy ? "…" : "Pin it"}
              </button>
              <span className="eyebrow" style={{ color: "var(--faint)" }}>
                Held above the feed for every manager, with a push to anyone who
                has notifications on, until you unpin it.
              </span>
            </div>
          </form>
        ) : (
          <button className="btn" style={{ marginBottom: "var(--s4)" }} onClick={() => setAnnouncing(true)}>
            <Megaphone size={14} /> Post an announcement
          </button>
        ))}

        {error && <div className="note" data-kind="error" style={{ marginBottom: "var(--s4)" }}>{error}</div>}

        {feedError ? (
          <div className="card">
            <div className="note" data-kind="error">Couldn&apos;t load the League Feed: {feedError}</div>
          </div>
        ) : !data ? (
          <div className="card"><SkeletonRows n={6} /></div>
        ) : (
          <LeagueFeed
            items={items}
            pinned={data.pinned}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onMore={() => void loadMore()}
            reacting={reacting}
            onReact={(item, emoji) => void react(item, emoji)}
            canPin={isCommissioner}
            unpinning={unpinning}
            onUnpin={(item) => void unpin(item)}
          />
        )}
      </main>
    </>
  );
}
