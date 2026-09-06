"use client";

import { FormEvent, useCallback, useState } from "react";
import { BarChart3, Plus, Send, X } from "lucide-react";
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
  const [reacting, setReacting] = useState<string | null>(null);
  const [voting, setVoting] = useState<string | null>(null);

  // The poll composer, closed by default. A question is a deliberate thing to
  // ask, so it costs one tap to open rather than sitting on screen competing
  // with the ordinary "say something" box.
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);

  const fetcher = useCallback(async (): Promise<HouseFeed> => {
    const { data, error: rpcError } = await supabaseBrowser()
      .rpc("ff_house_feed", { p_league_id: LEAGUE_ID, p_limit: 40 });
    if (rpcError) throw new Error(rpcError.message);
    return data as HouseFeed;
  }, []);

  const { data, status, error: feedError, refetch, mutate } = useLive<HouseFeed>(fetcher, {
    tables: ["league_messages", "activity_events", "reactions", "polls", "poll_votes"],
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

  /**
   * Press a reaction.
   *
   * Optimistic, because the whole value of a reaction is that it costs nothing
   * — a tally that waits for a round trip before moving feels broken, and the
   * server's answer is the same shape either way. The refetch afterwards
   * reconciles, and a failure puts the row back.
   */
  async function react(item: FeedItem, emoji: string) {
    const key = `${item.source}:${item.id}`;
    setReacting(key);

    const bump = (list: FeedItem[]) => list.map((f) => {
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

  async function vote(item: FeedItem, optionId: string) {
    if (!item.poll) return;
    setVoting(item.poll.poll_id);
    const { error: rpcError } = await supabaseBrowser().rpc("ff_vote", {
      p_poll_id: item.poll.poll_id, p_option_id: optionId,
    });
    setVoting(null);
    // Not optimistic, unlike a reaction: voting REVEALS the split, and guessing
    // at numbers we have never been allowed to see would be inventing them.
    if (rpcError) setError(rpcError.message);
    await refetch();
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const clean = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || clean.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabaseBrowser().rpc("ff_create_poll", {
      p_league_id: LEAGUE_ID, p_question: question.trim(), p_options: clean, p_closes_at: null,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setQuestion("");
    setOptions(["", ""]);
    setAsking(false);
    await refetch();
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

        {asking ? (
          <form onSubmit={ask} className="card" style={{ marginBottom: "var(--s4)" }}>
            <div className="card__head">
              <h2>Ask the house</h2>
              <button type="button" className="btn" data-size="icon" aria-label="Cancel"
                onClick={() => setAsking(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 8 }}>
              <input className="field" maxLength={140} value={question} autoFocus
                placeholder="Who wins the Chase trade?" aria-label="Your question"
                onChange={(e) => setQuestion(e.target.value)} />
              {options.map((o, i) => (
                <input key={i} className="field" maxLength={80} value={o}
                  placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                {options.length < 6 && (
                  <button type="button" className="btn" onClick={() => setOptions([...options, ""])}>
                    <Plus size={14} /> Another answer
                  </button>
                )}
                <button className="btn" data-v="primary" style={{ marginLeft: "auto" }}
                  disabled={busy || !question.trim() || options.filter((o) => o.trim()).length < 2}>
                  {busy ? "…" : "Ask"}
                </button>
              </div>
              <span className="eyebrow" style={{ color: "var(--faint)" }}>
                Nobody sees the split until they have answered, and no answer is
                ever shown with a name on it.
              </span>
            </div>
          </form>
        ) : (
          <button className="btn" style={{ marginBottom: "var(--s4)" }} onClick={() => setAsking(true)}>
            <BarChart3 size={14} /> Ask the house a question
          </button>
        )}

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
            reacting={reacting}
            onReact={(item, emoji) => void react(item, emoji)}
            voting={voting}
            onVote={(item, optionId) => void vote(item, optionId)}
          />
        )}
      </main>
    </>
  );
}
