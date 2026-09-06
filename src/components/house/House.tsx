"use client";

import Link from "next/link";
import { ArrowLeftRight, Gavel, MessageCircle, PenLine, Trophy, Megaphone, Swords } from "lucide-react";
import type { FeedItem } from "@/lib/types";
import { Reactions } from "./Reactions";

/**
 * The House: what the league said and what the league did, in one column.
 *
 * The two used to live apart — messages on /chat, events written by four
 * migrations and rendered nowhere. A trade going through is the most
 * talked-about thing that happens in a fantasy league, and it was happening
 * somewhere nobody was looking. Putting them together is the whole feature, so
 * the design job is to keep them distinguishable while they sit in one stream:
 * a line somebody typed reads as speech, a thing the league did reads as a
 * record of it.
 *
 * Presentation only, so /preview/house can hold it still.
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
};

/** Clock for today, date for anything older — a feed read on the day it
 *  happened wants a time; one read a week later wants a day. */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Said({ item, busy, onReact }: {
  item: FeedItem; busy: boolean; onReact: (emoji: string) => void;
}) {
  return (
    <div className="row" data-mine={item.mine} data-kind={item.kind} style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 5 }}>
          {item.mine ? "You" : item.author ?? "League manager"}
        </div>
        <div className="chat__body">{item.body}</div>
        {item.matchup && (
          <Link href={`/matchups?week=${item.matchup.week}`} className="chat__on">
            <MessageCircle size={11} /> on Week {item.matchup.week} · {item.matchup.away} vs {item.matchup.home}
          </Link>
        )}
        <Reactions reactions={item.reactions ?? []} busy={busy} onPress={onReact} />
      </div>
      <time className="num" style={{ color: "var(--dim)", fontSize: "var(--t-micro)" }}>
        {stamp(item.at)}
      </time>
    </div>
  );
}

function Did({ item, busy, onReact }: {
  item: FeedItem; busy: boolean; onReact: (emoji: string) => void;
}) {
  const Icon = ICON[item.kind] ?? Megaphone;
  return (
    <div className="row" data-kind={item.kind} style={{ alignItems: "flex-start" }}>
      <Icon size={14} style={{ color: "var(--faint)", flexShrink: 0, marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ lineHeight: 1.5 }}>{item.body}</div>
        {item.detail && (
          <div className="eyebrow" style={{ marginTop: 3, color: "var(--faint)" }}>{item.detail}</div>
        )}
        <Reactions reactions={item.reactions ?? []} busy={busy} onPress={onReact} />
      </div>
      <time className="num" style={{ color: "var(--dim)", fontSize: "var(--t-micro)" }}>
        {stamp(item.at)}
      </time>
    </div>
  );
}

export type HouseFilter = "all" | "talk" | "moves";

export function House({
  items, filter, onFilter, hasMore, loadingMore, onMore, reacting, onReact,
}: {
  items: FeedItem[];
  filter: HouseFilter;
  onFilter: (f: HouseFilter) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** `${source}:${id}` of the item mid-flight, so only its own row goes quiet. */
  reacting: string | null;
  onReact: (item: FeedItem, emoji: string) => void;
}) {
  const shown = items.filter((i) =>
    filter === "all" ? true : filter === "talk" ? i.source === "message" : i.source === "event");

  return (
    <section className="card">
      <div className="card__head">
        <h2>The House</h2>
        <div className="segmented" role="group" aria-label="Filter the feed">
          {([["all", "Everything"], ["talk", "Talk"], ["moves", "Moves"]] as [HouseFilter, string][])
            .map(([k, label]) => (
              <button
                key={k}
                className="segmented__opt"
                data-on={filter === k}
                aria-pressed={filter === k}
                onClick={() => onFilter(k)}
              >
                {label}
              </button>
            ))}
        </div>
      </div>

      <div className="rows">
        {shown.length === 0 && (
          <div className="empty">
            {items.length === 0
              ? <>Nothing yet.<br />Signings, waiver results and trades land here on their own — the rest is up to you.</>
              : "Nothing of that kind yet."}
          </div>
        )}
        {shown.map((item) => {
          const busy = reacting === `${item.source}:${item.id}`;
          const react = (emoji: string) => onReact(item, emoji);
          return item.source === "message"
            ? <Said key={`m-${item.id}`} item={item} busy={busy} onReact={react} />
            : <Did key={`e-${item.id}`} item={item} busy={busy} onReact={react} />;
        })}
      </div>

      {hasMore && filter !== "talk" && (
        <div style={{ padding: "var(--s4)", borderTop: "1px solid var(--rule)" }}>
          <button className="btn" style={{ width: "100%" }} disabled={loadingMore} onClick={onMore}>
            {loadingMore ? "…" : "Earlier"}
          </button>
        </div>
      )}
    </section>
  );
}
