"use client";

/**
 * Under the scoreboard on `/matchups/[id]`: the matchup moment, and this
 * game's own story so far.
 *
 * The moment is the one thing worth saying right now — a lead that just
 * changed hands, a side down to its Monday man, two men left to decide it —
 * from `matchupMoment`, the same function the game center's hero uses. The
 * story is this table's rows of `sunday_events`, newest first, three of them
 * until asked for more: the touchdowns and swings that made the score.
 */

import { useState } from "react";
import type { ScoreCard } from "@/lib/scoreboard";
import type { NflGame, SundayEvent } from "@/lib/sunday";
import { eventStory, matchupMoment } from "@/lib/gameday";
import { MomentBox } from "@/components/sunday/GameDay";

const ago = (iso: string, now: number) => {
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

export function MatchupMoment({ card, events, nfl = [], now }: {
  card: ScoreCard; events: SundayEvent[]; nfl?: NflGame[]; now: number;
}) {
  const [all, setAll] = useState(false);
  const moment = now ? matchupMoment(card, events, nfl, now) : null;
  const mine = events
    .filter((e) => e.matchup_id === card.id && e.type !== "red_zone" && (e.level >= 2 || e.type === "scoring"))
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  const shown = all ? mine : mine.slice(0, 3);
  if (!moment && mine.length === 0) return null;

  return (
    <>
      {moment && <MomentBox m={moment} className="mmoment" />}
      {mine.length > 0 && (
        <section className="mstory" aria-label="This matchup today">
          <div className="mstory__head">
            <span className="eyebrow">This matchup today</span>
            {mine.length > 3 && (
              <button type="button" className="mstory__more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
                {all ? "Fewer" : `All ${mine.length}`}
              </button>
            )}
          </div>
          <ol className="mstory__list">
            {shown.map((e) => {
              const s = eventStory(e);
              return (
                <li key={e.id} data-tone={s.tone}>
                  <span className="mstory__tag">{s.tag}<time dateTime={e.created_at}>{ago(e.created_at, now)}</time></span>
                  <b>{s.title}{s.impact && <em data-neg={s.impact.neg}> {s.impact.text}</em>}</b>
                  {s.line && <span>{s.line}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
}
