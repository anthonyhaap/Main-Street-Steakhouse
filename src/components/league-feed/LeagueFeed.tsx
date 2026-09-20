"use client";

import { ArrowLeftRight, Gavel, PinOff, PenLine, Trophy, Megaphone, Swords, Radio } from "lucide-react";
import type { LeagueFeedItem } from "@/lib/types";
import { Reactions } from "@/components/feed/Reactions";

/**
 * The League Feed: what the league did, and the news the league posted about
 * itself. Read-mostly, on purpose — this is the record, not the room. Talk
 * lives at /chat.
 *
 * Split out of the old merged House (see git history) once Chat grew replies
 * and @mentions of its own: a manager checking "what did I miss" wanted the
 * trades and the Sunday Live thread, not an argument scrolled past them.
 *
 * Presentation only, so /preview/league-feed can hold it still.
 */

const ICON: Record<string, typeof PenLine> = {
  transaction: PenLine,
  waiver: Gavel,
  trade: ArrowLeftRight,
  challenge: Swords,
  record: Trophy,
  announcement: Megaphone,
  deadline: Megaphone,
  draft: Swords,
  score: Trophy,
  system: Megaphone,
  house: Radio,
};

/** Clock for today, date for anything older. */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Row({ item, busy, onReact }: {
  item: LeagueFeedItem; busy: boolean; onReact: (emoji: string) => void;
}) {
  const announcement = item.source === "message" && item.kind === "announcement";
  const housePost = item.source === "message" && item.kind === "house";
  const Icon = announcement ? Megaphone : housePost ? Radio : (ICON[item.kind] ?? Megaphone);

  return (
    <div className="row" data-mine={item.mine} data-kind={item.kind} style={{ alignItems: "flex-start" }}>
      <Icon size={14} style={{ color: announcement ? "var(--gold)" : "var(--faint)", flexShrink: 0, marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {(announcement || housePost) && (
          <div className="eyebrow" style={{ marginBottom: 5, color: announcement ? "var(--gold)" : undefined }}>
            {housePost ? "The House" : item.mine ? "You" : `${item.author ?? "The Commissioner"} · Commissioner`}
          </div>
        )}
        <div style={{ lineHeight: 1.5 }}>{item.body}</div>
        {!announcement && !housePost && item.author && (
          <div className="eyebrow" style={{ marginTop: 3, color: "var(--faint)" }}>{item.author}</div>
        )}
        {item.detail && (
          <div className="eyebrow" style={{ marginTop: 3, color: "var(--faint)" }}>{item.detail}</div>
        )}
        <Reactions reactions={item.reactions ?? []} busy={busy} onPress={onReact} />
      </div>
      <time className="num" suppressHydrationWarning style={{ color: "var(--dim)", fontSize: "var(--t-micro)" }}>
        {stamp(item.at)}
      </time>
    </div>
  );
}

/** The pinned rail: a commissioner announcement, or the week's Sunday Live
 *  thread, held above the scroll until it is taken down. Only an announcement
 *  can be unpinned by hand — Sunday Live closes on its own Tuesday morning. */
function Pinned({ items, canPin, unpinning, onUnpin }: {
  items: LeagueFeedItem[]; canPin: boolean; unpinning: string | null; onUnpin: (item: LeagueFeedItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rows" style={{ borderBottom: "1px solid var(--rule)" }}>
      {items.map((item) => {
        const announcement = item.kind === "announcement";
        return (
          <div key={`pin-${item.id}`} className="row" style={{ alignItems: "flex-start", background: "var(--gold-wash, rgba(201,162,39,0.08))" }}>
            {announcement ? <Megaphone size={14} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 3 }} />
                          : <Radio size={14} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 3 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow" style={{ marginBottom: 5, color: "var(--gold)" }}>
                Pinned · {announcement ? (item.mine ? "You" : item.author ?? "The Commissioner") : "The House"}
              </div>
              <div className="chat__body">{item.body}</div>
            </div>
            {canPin && announcement && (
              <button
                className="btn"
                data-size="icon"
                disabled={unpinning === item.id}
                aria-label="Unpin this announcement"
                title="Unpin"
                onClick={() => onUnpin(item)}
              >
                <PinOff size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LeagueFeed({
  items, pinned = [], hasMore, loadingMore, onMore, reacting, onReact,
  canPin = false, unpinning = null, onUnpin,
}: {
  items: LeagueFeedItem[];
  /** Currently-pinned lines, shown above the ordinary feed. */
  pinned?: LeagueFeedItem[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** `${source}:${id}` of the item mid-flight, so only its own row goes quiet. */
  reacting: string | null;
  onReact: (item: LeagueFeedItem, emoji: string) => void;
  /** Whether this manager may take an announcement off the rail. */
  canPin?: boolean;
  /** The message id mid-flight, so only its own row goes quiet. */
  unpinning?: string | null;
  onUnpin?: (item: LeagueFeedItem) => void;
}) {
  return (
    <section className="card">
      <div className="card__head">
        <h2>League Feed</h2>
      </div>

      <Pinned items={pinned} canPin={canPin} unpinning={unpinning} onUnpin={(item) => onUnpin?.(item)} />

      <div className="rows">
        {items.length === 0 && (
          <div className="empty">
            Nothing yet.<br />Signings, waiver results, trades and league news land here on their own.
          </div>
        )}
        {items.map((item) => {
          const busy = reacting === `${item.source}:${item.id}`;
          return (
            <Row
              key={`${item.source}-${item.id}`}
              item={item}
              busy={busy}
              onReact={(emoji) => onReact(item, emoji)}
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
