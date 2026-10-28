"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { AtSign, BarChart3, Plus, Send, X } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { SkeletonRows } from "@/components/ui";
import { LEAGUE_ID } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useSession } from "@/lib/session";
import { markSeen } from "@/lib/unread";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ChatFeed, ChatItem } from "@/lib/types";
import { Chat } from "@/components/chat/Chat";

/**
 * Chat.
 *
 * The room: manager messages, one level of reply, @mentions, and the polls
 * people ask each other. It used to be merged with league news in one stream
 * ("The House") — see git history for that argument — but a manager mid-
 * conversation kept getting trades and waiver runs breaking up the thread,
 * and a manager checking what happened kept getting an argument in the way.
 * League news moved to /league-feed; this stayed the room.
 */
export default function ChatPage() {
  const { ready, team, teams } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Who this message replies to, if anyone — one level deep, so replying to a
  // reply is refused server-side and this UI never offers the button for one.
  const [replyTo, setReplyTo] = useState<ChatItem | null>(null);

  // @mentions: picked from the roster rather than typed, so a name always
  // resolves to a real seat instead of a string that merely looks like one.
  const [mentionPicker, setMentionPicker] = useState(false);
  const [mentioned, setMentioned] = useState<{ user_id: string; name: string }[]>([]);

  const [older, setOlder] = useState<ChatItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null);
  const [voting, setVoting] = useState<string | null>(null);

  // The poll composer, closed by default.
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);

  useEffect(() => {
    if (ready) void markSeen("chat");
  }, [ready]);

  const fetcher = useCallback(async (): Promise<ChatFeed> => {
    const { data, error: rpcError } = await supabaseBrowser()
      .rpc("ff_chat_feed", { p_league_id: LEAGUE_ID, p_limit: 40 });
    if (rpcError) throw new Error(rpcError.message);
    return data as ChatFeed;
  }, []);

  const { data, status, error: feedError, refetch, mutate } = useLive<ChatFeed>(fetcher, {
    tables: ["league_messages", "activity_events", "reactions", "polls", "poll_votes", "message_mentions"],
    channel: "chat",
    pollMs: 20000,
    enabled: ready,
  });

  async function loadMore() {
    const from = cursor ?? data?.next_before ?? null;
    if (!from || loadingMore) return;
    setLoadingMore(true);
    const { data: page } = await supabaseBrowser()
      .rpc("ff_chat_feed", { p_league_id: LEAGUE_ID, p_before: from, p_limit: 40 });
    setLoadingMore(false);
    if (!page) return;
    const next = page as ChatFeed;
    setOlder((prev) => [...prev, ...next.items]);
    setCursor(next.next_before);
  }

  /** Optimistic, same as the old House: the tally moves on press, and the
   *  refetch afterwards reconciles. */
  async function react(item: ChatItem, emoji: string) {
    const key = `${item.source}:${item.id}`;
    setReacting(key);

    const bump = (list: ChatItem[]) => list.map((f) => {
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

  async function vote(item: ChatItem, optionId: string) {
    if (!item.poll) return;
    setVoting(item.poll.poll_id);
    const { error: rpcError } = await supabaseBrowser().rpc("ff_vote", {
      p_poll_id: item.poll.poll_id, p_option_id: optionId,
    });
    setVoting(null);
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

  function toggleMention(user_id: string, name: string) {
    setMentioned((cur) => cur.some((m) => m.user_id === user_id)
      ? cur.filter((m) => m.user_id !== user_id)
      : [...cur, { user_id, name }]);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const { error: sendError } = await supabaseBrowser().rpc("ff_send_message", {
      p_league_id: LEAGUE_ID, p_body: value,
      p_parent_id: replyTo?.id ?? null,
      p_mentions: mentioned.length ? mentioned.map((m) => m.user_id) : null,
    });
    setBusy(false);
    if (sendError) return setError(sendError.message);
    setBody("");
    setReplyTo(null);
    setMentioned([]);
    setMentionPicker(false);
    await refetch();
  }

  const items = [...(data?.items ?? []), ...older];
  const hasMore = (cursor ?? data?.next_before ?? null) !== null;
  const teammates = (teams ?? []).filter((t) => t.owner_id && t.id !== team?.id);

  return (
    <>
      <TopBar status={status} />
      <main className="page">
        <header style={{ marginBottom: "var(--s5)" }}>
          <div className="eyebrow" data-tone="gold">Chat</div>
          <h1 className="display" style={{ fontSize: "var(--t-title)", margin: "var(--s2) 0" }}>
            The room.
          </h1>
          <p className="prose">
            Say something, reply, @mention a manager, or ask the room a
            question. League news — trades, waivers, announcements — lives on
            the <Link href="/league-feed">League Feed</Link> instead.
          </p>
        </header>

        {replyTo && (
          <div className="note" style={{ marginBottom: "var(--s2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>Replying to {replyTo.author ?? "League manager"}: {replyTo.body.slice(0, 80)}</span>
            <button type="button" className="btn" data-size="icon" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        <form onSubmit={send} style={{ marginBottom: "var(--s2)" }}>
          <div style={{ display: "flex", gap: "var(--s2)" }}>
            <input
              className="field"
              maxLength={1000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={replyTo ? "Write your reply…" : "Say something to the league…"}
              aria-label="Say something to the league"
            />
            <button
              type="button"
              className="btn"
              data-size="icon"
              data-v={mentionPicker ? "primary" : undefined}
              aria-label="Mention a manager"
              title="Mention a manager"
              onClick={() => setMentionPicker((v) => !v)}
            >
              <AtSign size={16} />
            </button>
            <button
              className="btn"
              data-v="primary"
              data-size="icon"
              disabled={busy || !body.trim()}
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </div>

          {mentionPicker && (
            <div className="card" style={{ marginTop: 8, padding: "var(--s3)" }}>
              {teammates.length === 0 ? (
                <span className="eyebrow" style={{ color: "var(--faint)" }}>No other managers yet.</span>
              ) : teammates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="segmented__opt"
                  data-on={mentioned.some((m) => m.user_id === t.owner_id)}
                  style={{ marginRight: 6, marginBottom: 6 }}
                  onClick={() => toggleMention(t.owner_id as string, t.manager_name ?? t.name)}
                >
                  {t.manager_name ?? t.name}
                </button>
              ))}
            </div>
          )}

          {mentioned.length > 0 && (
            <div className="eyebrow" style={{ marginTop: 6, color: "var(--faint)" }}>
              Mentioning: {mentioned.map((m) => `@${m.name}`).join(" ")}
            </div>
          )}
        </form>

        {asking ? (
          <form onSubmit={ask} className="card" style={{ marginBottom: "var(--s4)" }}>
            <div className="card__head">
              <h2>Ask the room</h2>
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
            <BarChart3 size={14} /> Ask the room a question
          </button>
        )}

        {error && <div className="note" data-kind="error" style={{ marginBottom: "var(--s4)" }}>{error}</div>}

        {feedError ? (
          <div className="card">
            <div className="note" data-kind="error">Couldn&apos;t load Chat: {feedError}</div>
          </div>
        ) : !data ? (
          <div className="card"><SkeletonRows n={6} /></div>
        ) : (
          <Chat
            items={items}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onMore={() => void loadMore()}
            reacting={reacting}
            onReact={(item, emoji) => void react(item, emoji)}
            voting={voting}
            onVote={(item, optionId) => void vote(item, optionId)}
            onReply={(item) => setReplyTo(item)}
          />
        )}
      </main>
    </>
  );
}
