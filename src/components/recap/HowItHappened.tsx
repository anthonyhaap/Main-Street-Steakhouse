"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { clockLabel, eventStory } from "@/lib/gameday";
import type { GameStory, WeekStory } from "@/lib/recap";
import type { SundayEvent } from "@/lib/sunday";

/**
 * How it happened: the week as the detector saw it, under the column that
 * could only see the final scores. Each table's result with the lead changes
 * behind it and the one that stood; then the comebacks, monster games and
 * season highs. Every sentence is a stored event's own, told through
 * `eventStory` — the same words the Game Center used on the day.
 *
 * Pure. Absent entirely for a week with nothing stored.
 */
export function HowItHappened({ story, week }: { story: WeekStory; week: number }) {
  const n = story.leadChanges;
  return (
    <section className="card recap__how" aria-label="How it happened">
      <div className="card__head">
        <h2>How it happened</h2>
        {n > 0 && <span className="eyebrow">{n} lead change{n === 1 ? "" : "s"}</span>}
      </div>
      <div className="card__body">
        {story.games.length > 0 && (
          <ul className="recap__games">
            {story.games.map((g) => <Game key={g.matchupId} g={g} week={week} />)}
          </ul>
        )}
        {story.moments.length > 0 && (
          <>
            <div className="eyebrow recap__sub">The moments</div>
            <ul className="recap__moments">
              {story.moments.map((e) => <Moment key={e.id} e={e} />)}
            </ul>
          </>
        )}
        <Link className="club__on recap__more" href={`/sunday?week=${week}`}>
          The whole day in the Game Center <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

const TIMES = ["", "once", "twice"];

function Game({ g, week }: { g: GameStory; week: number }) {
  return (
    <li data-mine={g.mine}>
      <Link href={`/matchups/${g.matchupId}?week=${week}`} className="recap__result">
        <b>{g.final.headline}</b>
        {g.mine && <span className="badge" data-tone="wine" data-size="sm">Your game</span>}
      </Link>
      {g.final.description && <span className="recap__note">{g.final.description}.</span>}
      {g.leadChanges > 0 && (
        <span className="recap__note">
          The lead changed hands {TIMES[g.leadChanges] ?? `${g.leadChanges} times`}
          {g.decider && <> · for good: {decided(g.decider)}, <time dateTime={g.decider.created_at}>{clockLabel(g.decider.created_at, true)}</time></>}
          .
        </span>
      )}
    </li>
  );
}

/** "Gus passes Lou" / "Puka Nacua, 40+ yard receiving touchdown (+9.1 Marcus)". */
function decided(e: SundayEvent): string {
  const s = eventStory(e);
  return `${s.title}${s.sub ? `, ${s.sub}` : ""}${s.impact ? ` (${s.impact.text})` : ""}`;
}

function Moment({ e }: { e: SundayEvent }) {
  const s = eventStory(e);
  return (
    <li>
      <span className="recap__tag">
        {s.tag}
        <time dateTime={e.created_at}>{clockLabel(e.created_at, true)}</time>
      </span>
      <b>{s.title}</b>
      {s.line && <span className="recap__note">{s.line}</span>}
    </li>
  );
}
