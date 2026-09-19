"use client";

import Link from "next/link";
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Reactions reactions={item.reactions ?? []} busy={busy} onPress={onReact} />
          {onReply && (
            <button className="btn" data-size="icon" aria-label="Reply" title="Reply" onClick={onReply}>
              <CornerUpLeft size={13} />
            </button>
          )}
        </div>
      </div>
      <time className="num" suppressHydrationWarning style={{ color: "var(--dim)", fontSize: "var(--t-micro)" }}>
        {stamp(item.at)}
      </time>
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
        <Reactions reactions={item.reactions ?? []} busy={busy} onPress={onReact} />
      </div>
      <time className="num" suppressHydrationWarning style={{ color: "var(--dim)", fontSize: "var(--t-micro)" }}>
        {stamp(item.at)}
      </time>
    </div>
  );
}

export function Chat({
  items, hasMore, loadingMore, onMore, reacting, onReact, voting, onVote, onReply,
}: {
  items: ChatItem[];
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
  return (
    <section className="card">
      <div className="card__head">
        <h2>Chat</h2>
      </div>

      <div className="rows">
        {items.length === 0 && (
          <div className="empty">
            Nothing yet.<br />Say something to the league, or ask it a question.
          </div>
        )}
        {items.map((item) => {
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

      {hasMore && (
        <div style={{ padding: "var(--s4)", borderTop: "1px solid var(--rule)" }}>
          <button className="btn" style={{ width: "100%" }} disabled={loadingMore} onClick={onMore}>
            {loadingMore ? "…" : "Earlier"}
          </button>
        </div>
      )}
    </section>
  );
}
