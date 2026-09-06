"use client";

/**
 * Fixture harness for the House. Reads no database.
 *
 * The feature is that two streams sit in one column and stay distinguishable,
 * so the fixture interleaves them the way a real Tuesday does: a trade goes
 * through, somebody complains about it, waivers settle, somebody gloats. If the
 * design ever stops making "what happened" and "what was said" tell apart at a
 * glance, it should be visible here first.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { House, type HouseFilter } from "@/components/house/House";
import type { FeedItem, Reaction } from "@/lib/types";

const NOW = new Date();
const MIDNIGHT = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();
/* Anchored to midnight, not "minutes ago": a fixture built from offsets stops
 * meaning what it says in the small hours. Same lesson as /preview/ledger. */
const today = (minutesAgo: number) =>
  new Date(Math.max(MIDNIGHT, NOW.getTime() - minutesAgo * 60_000)).toISOString();

const ITEMS: FeedItem[] = [
  { id: "1", at: today(4), source: "message", kind: "manager", body: "that trade is a robbery and you all know it",
    detail: null, author: "Bo", author_team_id: "t2", mine: false, source_type: null, source_id: null, matchup: null,
    reactions: [{ emoji: "💀", count: 3, mine: false }] },
  { id: "2", at: today(9), source: "event", kind: "trade",
    body: "Chuck Wagon and Gridiron Butchers made a trade", detail: "Ja'Marr Chase, Bijan Robinson",
    author: null, author_team_id: null, mine: false, source_type: "trade", source_id: null, matchup: null,
    reactions: [{ emoji: "🔥", count: 5, mine: true }, { emoji: "👀", count: 2, mine: false }] },
  { id: "3", at: today(40), source: "message", kind: "manager", body: "anyone else still missing a kicker",
    detail: null, author: "You", author_team_id: "t1", mine: true, source_type: null, source_id: null, reactions: [],
    matchup: { id: "m1", week: 3, home: "Prime Cut", away: "Gridiron Butchers", mine: true } },
  { id: "4", at: today(180), source: "event", kind: "waiver",
    body: "Waivers cleared: 4 of 7 claims awarded", detail: "Week 3",
    author: null, author_team_id: null, mine: false, source_type: "waiver_run", source_id: null, matchup: null,
    reactions: [] },
  { id: "5", at: today(400), source: "event", kind: "transaction",
    body: "Brisket Brigade signed Rome Odunze and let Roschon Johnson go", detail: "Week 3",
    author: "Brisket Brigade", author_team_id: "t3", mine: false, source_type: "transaction", source_id: null, matchup: null,
    reactions: [] },
  { id: "6", at: today(900), source: "message", kind: "house",
    body: "Week 2 is written up. Somebody left 34 points on their bench.",
    detail: null, author: "The House", author_team_id: null, mine: false,
    source_type: null, source_id: null, matchup: null, reactions: [{ emoji: "🥩", count: 8, mine: false }] },
];

export default function PreviewHouse() {
  const [filter, setFilter] = useState<HouseFilter>("all");
  const [empty, setEmpty] = useState(false);
  const [items, setItems] = useState<FeedItem[]>(ITEMS);

  /* The same toggle the real page does optimistically, so the fixture can be
     pressed and the two states of a reaction button are both reachable. */
  function react(target: FeedItem, emoji: string) {
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
            <h2>Preview: the House</h2>
            <div className="segmented">
              <button className="segmented__opt" data-on={!empty} onClick={() => setEmpty(false)}>Busy</button>
              <button className="segmented__opt" data-on={empty} onClick={() => setEmpty(true)}>Quiet</button>
            </div>
          </div>
        </div>

        <House
          items={empty ? [] : items}
          filter={filter}
          onFilter={setFilter}
          hasMore={!empty}
          loadingMore={false}
          onMore={() => {}}
          reacting={null}
          onReact={react}
        />
      </main>
    </>
  );
}
