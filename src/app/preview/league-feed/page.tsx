"use client";

/**
 * Fixture harness for the League Feed. Reads no database.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { LeagueFeed } from "@/components/league-feed/LeagueFeed";
import type { LeagueFeedItem, Reaction } from "@/lib/types";

const NOW = new Date();
const MIDNIGHT = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();
const today = (minutesAgo: number) =>
  new Date(Math.max(MIDNIGHT, NOW.getTime() - minutesAgo * 60_000)).toISOString();

const ITEMS: LeagueFeedItem[] = [
  { id: "2", at: today(9), source: "event", kind: "trade",
    body: "Chuck Wagon and Gridiron Butchers made a trade", detail: "Ja'Marr Chase, Bijan Robinson",
    author: null, author_team_id: null, mine: false, source_type: "trade", source_id: null,
    reactions: [{ emoji: "🔥", count: 5, mine: true }, { emoji: "👀", count: 2, mine: false }] },
  { id: "4", at: today(180), source: "event", kind: "waiver",
    body: "Waivers cleared: 4 of 7 claims awarded", detail: "Week 3",
    author: null, author_team_id: null, mine: false, source_type: "waiver_run", source_id: null,
    reactions: [] },
  { id: "5", at: today(400), source: "event", kind: "transaction",
    body: "Brisket Brigade signed Rome Odunze and let Roschon Johnson go", detail: "Week 3",
    author: "Brisket Brigade", author_team_id: "t3", mine: false, source_type: "transaction", source_id: null,
    reactions: [] },
  { id: "11", at: today(910), source: "event", kind: "award",
    body: "Player of the week: Ja'Marr Chase", detail: "38.4 for Chuck Wagon · Week 2",
    author: null, author_team_id: null, mine: false, source_type: "recap", source_id: null,
    reactions: [] },
  { id: "6", at: today(900), source: "message", kind: "house",
    body: "Week 2 is written up. Somebody left 34 points on their bench.",
    detail: null, author: "The House", author_team_id: null, mine: false,
    source_type: null, source_id: null,
    reactions: [{ emoji: "🥩", count: 8, mine: false }] },
  { id: "9", at: today(600), source: "message", kind: "announcement", pinned: true,
    body: "Draft moves to Thursday at 8pm — same slots, new night.",
    detail: null, author: "Ada", author_team_id: "t1", mine: false,
    source_type: null, source_id: null, reactions: [] },
  { id: "10", at: today(30), source: "message", kind: "house", pinned: true,
    body: "🏈 Sunday Live — talk trash, react to every touchdown and bad beat. Pinned through Tuesday.",
    detail: null, author: null, author_team_id: null, mine: false,
    source_type: null, source_id: null, reactions: [{ emoji: "👀", count: 4, mine: false }] },
];

export default function PreviewLeagueFeed() {
  const [empty, setEmpty] = useState(false);
  const [commissioner, setCommissioner] = useState(true);
  const [items, setItems] = useState<LeagueFeedItem[]>(ITEMS);

  function unpin(target: LeagueFeedItem) {
    setItems((list) => list.map((f) => (f.id === target.id ? { ...f, pinned: false } : f)));
  }

  function react(target: LeagueFeedItem, emoji: string) {
    setItems((list) => list.map((f) => {
      if (f.id !== target.id || f.source !== target.source) return f;
      const had = f.reactions.find((r) => r.emoji === emoji);
      const next: Reaction[] = had
        ? f.reactions
            .map((r) => r.emoji === emoji
              ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine }
              : r)
            .filter((r) => r.count > 0)
        : [...f.reactions, { emoji, count: 1, mine: true }];
      return { ...f, reactions: next };
    }));
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head">
            <h2>Preview: League Feed</h2>
            <div className="segmented">
              <button className="segmented__opt" data-on={!empty} onClick={() => setEmpty(false)}>Busy</button>
              <button className="segmented__opt" data-on={empty} onClick={() => setEmpty(true)}>Quiet</button>
            </div>
            <div className="segmented">
              <button className="segmented__opt" data-on={commissioner} onClick={() => setCommissioner(true)}>Commissioner</button>
              <button className="segmented__opt" data-on={!commissioner} onClick={() => setCommissioner(false)}>Manager</button>
            </div>
          </div>
        </div>

        <LeagueFeed
          items={empty ? [] : items}
          pinned={empty ? [] : items.filter((i) => i.pinned)}
          hasMore={!empty}
          loadingMore={false}
          onMore={() => {}}
          reacting={null}
          onReact={react}
          canPin={commissioner}
          unpinning={null}
          onUnpin={unpin}
        />
      </main>
    </>
  );
}
