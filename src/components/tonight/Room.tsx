"use client";

/**
 * Overheard — the clubhouse, on the front page.
 *
 * Chat and challenges were rooms you had to remember to visit, which is a fair
 * description of every group chat that died. The last few things said in the
 * league now sit under the card — including the lines said on a matchup, which
 * arrive with the game they were said about and a way back to it.
 *
 * It is deliberately a *second* call, made in the browser after the card is
 * already painted. The briefing answers the three questions a manager opens
 * the app with; the room is what makes them open it again on a Tuesday, and it
 * should never be in front of the first paint to prove it.
 *
 * `RoomFeed` is pure markup so `/preview/tonight` renders it from a fixture;
 * `Room` is the live one around it.
 */

import Link from "next/link";
import { useCallback } from "react";
import { MessageCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { LEAGUE_ID } from "@/lib/config";
import { aboutMyTable, roomLine, type RoomFeed as Feed } from "@/lib/briefing";
import { freshness } from "@/lib/scoreboard";

export function RoomBoard({ feed, now }: { feed: Feed; now: number }) {
  const mine = feed.mine;
  const aboutMine = aboutMyTable(feed);

  return (
    <section className="club" aria-label="The clubhouse">
      <div className="room__head">
        {/* Not "the room" — that is the carousel of six tables, one section up. */}
        <span className="eyebrow">Overheard</span>
        <Link href="/chat" className="eyebrow" data-tone="gold" style={{ textDecoration: "none" }}>
          Clubhouse →
        </Link>
      </div>

      {/* Your own table first: the thread you are actually in. */}
      {mine && aboutMine && (
        <Link className="club__mine" href={`/matchups?week=${mine.week}`}>
          <MessageCircle size={14} />
          <b>{aboutMine}</b>
          {mine.last && (
            <span className="club__quote">
              {mine.last.mine ? "You" : mine.last.author}: {mine.last.body}
            </span>
          )}
        </Link>
      )}

      {feed.recent.length === 0 ? (
        <p className="club__empty">{roomLine(feed)}</p>
      ) : (
        <ul className="club__lines">
          {feed.recent.map((line) => (
            <li key={line.id} data-mine={line.mine}>
              <span className="club__said">
                <b>{line.mine ? "You" : line.author}</b>
                <time dateTime={line.created_at}>{freshness(line.created_at, now)}</time>
              </span>
              <p>{line.body}</p>
              {line.about && (
                <Link className="club__on" href={`/matchups?week=${line.about.week}`}>
                  on {line.about.mine ? "your game" : `${line.about.away} vs ${line.about.home}`}
                  {" · "}week {line.about.week}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="club__foot">
        <span>{roomLine(feed)}</span>
        <Link href="/chat">Say something →</Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the live -- */

export function Room({ now, enabled }: { now: number; enabled: boolean }) {
  const fetcher = useCallback(async (): Promise<Feed> => {
    const { data, error } = await supabaseBrowser()
      .rpc("ff_clubhouse_feed", { p_league_id: LEAGUE_ID, p_limit: 4 });
    if (error) throw new Error(error.message);
    return data as Feed;
  }, []);

  const { data } = useLive<Feed>(fetcher, {
    tables: ["league_messages"],
    channel: "room",
    pollMs: 60000,
    enabled,
  });

  // No skeleton: the room is below the card and arrives when it arrives. A
  // shimmering box under a finished card is a worse lie than an empty space.
  if (!data) return null;
  return <RoomBoard feed={data} now={now} />;
}
