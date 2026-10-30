"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CornerUpLeft, MessageCircle } from "lucide-react";
import type { ChatItem } from "@/lib/types";
import { Reactions } from "@/components/feed/Reactions";
import { PollCard } from "@/components/feed/PollCard";

/**
 * Chat: the room. Manager messages — with one level of reply and @mentions —
 * and the polls people ask each other. League news (trades, waiver runs,
 * announcements, Sunday Live) lives at /league-feed instead; this is talk,
 * not the record.
 *
 * Presentation only, so /preview/chat can hold it still.
 */

/** Clock for today, date for anything older. */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * When it was said, at the end of the line the reactions sit on. It used to
 * hold a column down the right of every message, which on a phone took sixty
 * pixels off every line of the message to print five characters once.
 */
function Stamp({ at }: { at: string }) {
  return (
    <time className="num row__stamp" suppressHydrationWarning>
      {stamp(at)}
    </time>
  );
}

function Said({ item, busy, onReact, onReply }: {
  item: ChatItem; busy: boolean; onReact: (emoji: string) => void; onReply: (() => void) | null;
}) {
  return (
    <div className="row" data-mine={item.mine} data-kind={item.kind} style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 5 }}>
          {item.mine ? "You" : item.author ?? "League manager"}
        </div>
        {item.parent && (
          <div className="chat__reply-to">
            <CornerUpLeft size={11} aria-hidden />
            {item.parent.author}: {item.parent.body}
          </div>
        )}
        <div className="chat__body">{item.body}</div>
        {item.mentions.length > 0 && (
          <div className="eyebrow" style={{ marginTop: 3, color: "var(--faint)" }}>
            {item.mentions.map((m) => `@${m.author}`).join(" ")}
          </div>
        )}
        {item.matchup && (
          <Link href={`/matchups?week=${item.matchup.week}`} className="chat__on">
            <MessageCircle size={11} /> on Week {item.matchup.week} · {item.matchup.away} vs {item.matchup.home}
          </Link>
        )}
        <div className="row__foot">
          <Reactions reactions={item.reactions ?? []} busy={busy} onPress={onReact} />
          {onReply && (
            <button className="btn" data-size="icon" aria-label="Reply" title="Reply" onClick={onReply}>
              <CornerUpLeft size={13} />
            </button>
          )}
          <Stamp at={item.at} />
        </div>
      </div>
    </div>
  );
}

/** A question, with its answers under it. */
function Asked({ item, busy, voting, onReact, onVote }: {
  item: ChatItem; busy: boolean; voting: boolean;
  onReact: (emoji: string) => void; onVote: (optionId: string) => void;
}) {
  return (
    <div className="row" data-mine={item.mine} data-kind="poll" style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 5 }}>
          {item.mine ? "You asked" : `${item.author ?? "League manager"} asked`}
        </div>
        <div className="chat__body">{item.body}</div>
        {item.poll && <PollCard poll={item.poll} busy={voting} onVote={onVote} />}
        <div className="row__foot">
          <Reactions reactions={item.reactions ?? []} busy={busy} onPress={onReact} />
          <Stamp at={item.at} />
        </div>
      </div>
    </div>
  );
}

/**
 * Keep the newest line in view, the way a chat does: to the bottom on the
 * first load, and again when a line arrives — but only if the reader was
 * already at the bottom, or wrote it. Somebody scrolled back through the
 * argument is not yanked out of it by the next message.
 */
function useStickToLatest(items: ChatItem[], on: boolean) {
  const newest = items[0] ? `${items[0].source}:${items[0].id}` : null;
  const seen = useRef<string | null>(null);
  const nearBottom = useRef(true);

  useEffect(() => {
    if (!on) return;
    const onScroll = () => {
      const gap = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      nearBottom.current = gap < 240;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [on]);

  useEffect(() => {
    if (!on || !newest || newest === seen.current) return;
    const first = seen.current === null;
    seen.current = newest;
    if (first || nearBottom.current || items[0]?.mine) {
      // After paint, so the line that just arrived has a height to scroll past.
      requestAnimationFrame(() => window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: first ? "instant" : "smooth",
      }));
    }
  }, [on, newest, items]);
}

export function Chat({
  items, order = "newest-first", hasMore, loadingMore, onMore, reacting, onReact, voting, onVote, onReply,
}: {
  /** Newest first, the order `ff_chat_feed` pages in. */
  items: ChatItem[];
  /**
   * How the room reads. "oldest-first" is a conversation — newest at the
   * bottom over the composer, "Earlier" at the top — and keeps the newest
   * line in view. "newest-first" is the notice board it used to be.
   */
  order?: "newest-first" | "oldest-first";
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** `${source}:${id}` of the item mid-flight, so only its own row goes quiet. */
  reacting: string | null;
  onReact: (item: ChatItem, emoji: string) => void;
  /** The poll id mid-flight, so only its own answers go quiet. */
  voting: string | null;
  onVote: (item: ChatItem, optionId: string) => void;
  /** A top-level manager message was picked to reply to. Only offered for
   *  messages that are not themselves a reply — threads stay one level deep. */
  onReply: (item: ChatItem) => void;
}) {
  const down = order === "oldest-first";
  useStickToLatest(items, down);
  const shown = down ? [...items].reverse() : items;
  const earlier = hasMore && (
    <div className="chat__earlier" style={{ padding: "var(--s3) var(--s4)", [down ? "borderBottom" : "borderTop"]: "1px solid var(--rule)" }}>
      <button className="btn" style={{ width: "100%" }} disabled={loadingMore} onClick={onMore}>
        {loadingMore ? "…" : "Earlier"}
      </button>
    </div>
  );

  return (
    <section className="card chat-log" data-order={order}>
      <div className="card__head">
        <h2>Chat</h2>
      </div>

      {down && earlier}
      <div className="rows">
        {items.length === 0 && (
          <div className="empty">
            Nothing yet.<br />Say something to the league, or ask it a question.
          </div>
        )}
        {shown.map((item) => {
          const busy = reacting === `${item.source}:${item.id}`;
          const react = (emoji: string) => onReact(item, emoji);
          if (item.source === "poll") {
            return (
              <Asked
                key={`p-${item.id}`}
                item={item}
                busy={busy}
                voting={voting === item.id}
                onReact={react}
                onVote={(optionId) => onVote(item, optionId)}
              />
            );
          }
          return (
            <Said
              key={`m-${item.id}`}
              item={item}
              busy={busy}
              onReact={react}
              onReply={item.parent === null ? () => onReply(item) : null}
            />
          );
        })}
      </div>

      {!down && earlier}
    </section>
  );
}
