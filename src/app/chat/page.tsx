"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Megaphone, Plus, Send, X } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { FeedItem, FeedReply, HouseFeed } from "@/lib/types";
import { EMPTY_THREAD, House, threadKey, type HouseFilter, type ThreadState } from "@/components/house/House";

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
  const { ready, isCommissioner } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HouseFilter>("all");
  const [unpinning, setUnpinning] = useState<string | null>(null);

  // The announcement composer, closed by default and separate from the
  // ordinary "say something" box — a rule change or a deadline is a deliberate
  // thing to post, not a line typed in passing, and it costs one tap to reach.
  const [announcing, setAnnouncing] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // Pages fetched beyond the first. Kept apart from the live head so that a
  // refetch — a poll, a realtime nudge — refreshes the top of the feed without
  // throwing away what the manager has already scrolled past.
  const [older, setOlder] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null);
  const [voting, setVoting] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});

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
    tables: ["league_messages", "activity_events", "reactions", "polls", "poll_votes", "feed_replies"],
    channel: "house",
    pollMs: 30000,
    enabled: ready,
  });

  // How far behind a manager was the moment he opened the House — read first,
  // then immediately marked seen, so the number on screen is "how much you
  // missed" rather than a count that has already zeroed itself out under him.
  const [caughtUpOn, setCaughtUpOn] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const { data } = await supabaseBrowser().rpc("ff_feed_unread_count", { p_league_id: LEAGUE_ID });
      if (typeof data === "number") setCaughtUpOn(data);
      await supabaseBrowser().rpc("ff_feed_mark_seen", { p_league_id: LEAGUE_ID });
    })();
  }, [ready]);

  // A ref rather than a dependency: reading it from the effect below must not
  // re-run that effect on every keystroke of a reply draft, only when the
  // feed itself refetches.
  const threadsRef = useRef(threads);
  useEffect(() => { threadsRef.current = threads; }, [threads]);

  // `feed_replies` is one of the tables the feed already refetches on, so a
  // reply from someone else lands here as an ordinary refetch of `data` — but
  // an open thread's replies were fetched once, on demand, and cached in
  // `threads`, and refetching the feed does not touch that cache. Re-pull any
  // thread that is currently open so a reply posted while you are reading one
  // actually shows up in it, instead of waiting for you to close and reopen.
  useEffect(() => {
    if (!data) return;
    for (const [key, t] of Object.entries(threadsRef.current)) {
      if (!t.open) continue;
      const [source, id] = key.split(":") as [FeedItem["source"], string];
      void supabaseBrowser().rpc("ff_feed_replies", { p_source: source, p_target_id: id })
        .then(({ data: rows, error: rpcError }) => {
          if (rpcError) return;
          setThreads((prev) => (prev[key]?.open ? { ...prev, [key]: { ...prev[key], replies: rows as FeedReply[] } } : prev));
        });
    }
  }, [data]);

  /** Open or close one item's thread, fetching it the first time it opens. */
  async function toggleThread(item: FeedItem) {
    const key = threadKey(item);
    const current = threads[key] ?? EMPTY_THREAD;
    if (current.open) {
      setThreads((prev) => ({ ...prev, [key]: { ...current, open: false } }));
      return;
    }
    setThreads((prev) => ({ ...prev, [key]: { ...current, open: true, loading: current.replies === null } }));
    if (current.replies !== null) return;
    const { data: rows, error: rpcError } = await supabaseBrowser()
      .rpc("ff_feed_replies", { p_source: item.source, p_target_id: item.id });
    setThreads((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? current), loading: false, replies: rpcError ? [] : (rows as FeedReply[]) },
    }));
    if (rpcError) setError(rpcError.message);
  }

  function draftReply(item: FeedItem, value: string) {
    const key = threadKey(item);
    setThreads((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_THREAD), draft: value } }));
  }

  async function reply(item: FeedItem) {
    const key = threadKey(item);
    const current = threads[key] ?? EMPTY_THREAD;
    const value = current.draft.trim();
    if (!value || current.busy) return;
    setThreads((prev) => ({ ...prev, [key]: { ...current, busy: true } }));
    const { data: rows, error: rpcError } = await supabaseBrowser()
      .rpc("ff_reply", { p_league_id: LEAGUE_ID, p_source: item.source, p_target_id: item.id, p_body: value });
    setThreads((prev) => ({
      ...prev,
      [key]: rpcError
        ? { ...(prev[key] ?? current), busy: false }
        : { open: true, loading: false, busy: false, draft: "", replies: rows as FeedReply[] },
    }));
    if (rpcError) return setError(rpcError.message);
    // `refetch` re-reads the live page, which fixes up `data` on its own —
    // but an item paged into `older` by "Earlier" is never part of that
    // fetch, so its reply_count would otherwise sit stale until a hard
    // reload the next time this same item's thread is closed and reopened.
    setOlder((list) => list.map((f) =>
      f.id === item.id && f.source === item.source ? { ...f, reply_count: f.reply_count + 1 } : f));
    await refetch();
  }

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

  async function unpin(item: FeedItem) {
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
          <div className="eyebrow" data-tone="gold">The House</div>
          <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "var(--s2) 0" }}>
            Everything, as it happens.
          </h1>
          <p className="prose">
            Signings, waiver results and trades land here on their own, next to
            whatever the league has to say about them. Anything said on a matchup
            card shows up too, with the game it was said about.
          </p>
          {/* What you missed, stated once as you walk in — not a badge that
              keeps counting after you have, in fact, caught up. */}
          {!!caughtUpOn && (
            <div className="eyebrow" style={{ marginTop: "var(--s2)", color: "var(--gold)" }}>
              {caughtUpOn === 1 ? "1 thing" : `${caughtUpOn} things`} happened since you were last here.
            </div>
          )}
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
            pinned={data.pinned}
            filter={filter}
            onFilter={setFilter}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onMore={() => void loadMore()}
            reacting={reacting}
            onReact={(item, emoji) => void react(item, emoji)}
            voting={voting}
            onVote={(item, optionId) => void vote(item, optionId)}
            canPin={isCommissioner}
            unpinning={unpinning}
            onUnpin={(item) => void unpin(item)}
            threads={threads}
            onToggleThread={(item) => void toggleThread(item)}
            onDraftChange={draftReply}
            onReply={(item) => void reply(item)}
          />
        )}
      </main>
    </>
  );
}
