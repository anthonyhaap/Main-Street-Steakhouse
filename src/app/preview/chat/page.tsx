"use client";

/**
 * Fixture harness for Chat. Reads no database.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { Chat } from "@/components/chat/Chat";
import type { ChatItem, Poll, Reaction } from "@/lib/types";

const NOW = new Date();
const MIDNIGHT = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();
const today = (minutesAgo: number) =>
  new Date(Math.max(MIDNIGHT, NOW.getTime() - minutesAgo * 60_000)).toISOString();

const ITEMS: ChatItem[] = [
  { id: "1", at: today(4), source: "message", kind: "manager", body: "that trade is a robbery and you all know it",
    detail: null, author: "Bo", author_team_id: "t2", mine: false, source_type: null, source_id: null, matchup: null,
    reactions: [{ emoji: "💀", count: 3, mine: true }], poll: null, parent: null, mentions: [] },
  { id: "2", at: today(9), source: "message", kind: "manager", body: "you're just mad you didn't think of it first",
    detail: null, author: "You", author_team_id: "t1", mine: true, source_type: null, source_id: null, matchup: null,
    reactions: [], poll: null, mentions: [],
    parent: { id: "1", author: "Bo", body: "that trade is a robbery and you all know it" } },
  { id: "3", at: today(40), source: "message", kind: "manager", body: "anyone else still missing a kicker",
    detail: null, author: "You", author_team_id: "t1", mine: true, source_type: null, source_id: null, poll: null, parent: null,
    reactions: [], mentions: [{ user_id: "u2", author: "Bo" }],
    matchup: { id: "m1", week: 3, home: "Prime Cut", away: "Gridiron Butchers", mine: true } },
  { id: "7", at: today(20), source: "poll", kind: "poll",
    body: "Who wins the Chase trade?",
    detail: null, author: "Bo", author_team_id: "t2", mine: false,
    source_type: null, source_id: null, matchup: null, reactions: [], parent: null, mentions: [],
    poll: {
      poll_id: "7", question: "Who wins the Chase trade?", closes_at: null, closed: false,
      votes: 7, my_option: null, revealed: false,
      options: [
        { option_id: "a", label: "Chuck Wagon, easily", count: null, mine: false },
        { option_id: "b", label: "Gridiron Butchers", count: null, mine: false },
        { option_id: "c", label: "Nobody, it's a wash", count: null, mine: false },
      ],
    } },
  { id: "8", at: today(300), source: "poll", kind: "poll",
    body: "Move the draft to Thursday?",
    detail: null, author: "You", author_team_id: "t1", mine: true,
    source_type: null, source_id: null, matchup: null, reactions: [], parent: null, mentions: [],
    poll: {
      poll_id: "8", question: "Move the draft to Thursday?", closes_at: null, closed: false,
      votes: 9, my_option: "y", revealed: true,
      options: [
        { option_id: "y", label: "Yes", count: 6, mine: true },
        { option_id: "n", label: "No, Sunday or nothing", count: 3, mine: false },
      ],
    } },
];

export default function PreviewChat() {
  const [empty, setEmpty] = useState(false);
  const [items, setItems] = useState<ChatItem[]>(ITEMS);

  function vote(target: ChatItem, optionId: string) {
    setItems((list) => list.map((f) => {
      if (f.id !== target.id || !f.poll) return f;
      const had = f.poll.my_option;
      const options = f.poll.options.map((o) => ({
        ...o,
        mine: o.option_id === optionId,
        count: (o.count ?? 0)
          + (o.option_id === optionId ? 1 : 0)
          - (had && o.option_id === had ? 1 : 0),
      }));
      const poll: Poll = { ...f.poll, my_option: optionId, revealed: true, votes: f.poll.votes + (had ? 0 : 1), options };
      return { ...f, poll };
    }));
  }

  function react(target: ChatItem, emoji: string) {
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
            <h2>Preview: Chat</h2>
            <div className="segmented">
              <button className="segmented__opt" data-on={!empty} onClick={() => setEmpty(false)}>Busy</button>
              <button className="segmented__opt" data-on={empty} onClick={() => setEmpty(true)}>Quiet</button>
            </div>
          </div>
        </div>

        <Chat
          items={empty ? [] : items}
          hasMore={!empty}
          loadingMore={false}
          onMore={() => {}}
          reacting={null}
          onReact={react}
          voting={null}
          onVote={vote}
          onReply={() => {}}
        />
      </main>
    </>
  );
}
