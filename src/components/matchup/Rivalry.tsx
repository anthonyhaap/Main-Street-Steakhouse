"use client";

/**
 * The rivalry, on the game it is about.
 *
 * All of this was already computed. `ff_history` has scored rivalries since the
 * history wall was built, and the wall renders the top few — its own comment
 * quotes the line the feature exists for: "wait, I'm 2-11 against Mike?". But
 * reaching that line meant opening History and reading a twelve-by-twelve grid,
 * which is a thing a league does once, in August.
 *
 * The moment it matters is the moment you are about to play him. So the record
 * sits on the card, in one sentence, unopened — a summary you have to tap for
 * is a summary nobody reads. What a tap buys is the detail: the last meeting,
 * the one everybody still brings up, and how far back it goes.
 *
 * Pure on purpose, like `TalkThread` next door: the week's rivalries arrive
 * with the board in one call, so there is nothing to fetch here and
 * `/preview/matchups` renders a real one from a fixture.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Swords } from "lucide-react";
import { meetingLine, rivalryLine, roundLabel, type RivalryCard } from "@/lib/history";
import type { RivalrySundays } from "@/lib/sundayline";

export function Rivalry({ card, me, sundays = null }: {
  card: RivalryCard;
  /** The reading manager, when he is one of the two. Changes the wording. */
  me?: string | null;
  /** `rivalrySundays` for the two teams: the afternoons the game center stored. */
  sundays?: RivalrySundays | null;
}) {
  const [open, setOpen] = useState(false);

  // Two managers who have never met is a real answer, but it is not worth a
  // row on a scoreboard: the card would be a sentence saying there is nothing
  // to say. It stays silent until there is a record.
  if (card.games === 0) return null;

  const detail = card.last || card.biggest || card.playoff_games > 0 || !!sundays;

  return (
    <div className="riv">
      <button
        className="riv__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!detail}
      >
        <Swords size={14} aria-hidden />
        <span className="riv__line">{rivalryLine(card, me)}</span>
        {detail && (open
          ? <ChevronDown size={15} aria-hidden />
          : <ChevronRight size={15} aria-hidden />)}
      </button>

      {open && detail && (
        <dl className="riv__detail">
          {card.last && (
            <div>
              <dt>Last time</dt>
              <dd>
                {card.last.season} · {roundLabel(card.last.round, card.last.week)}
                <span> · {meetingLine(card.last)}</span>
              </dd>
            </div>
          )}
          {/* Only when it is not the game already named directly above it. */}
          {card.biggest && !sameGame(card.biggest, card.last) && (
            <div>
              <dt>Worst of it</dt>
              <dd>
                {card.biggest.season} · {roundLabel("regular", card.biggest.week)}
                <span> · {meetingLine({ ...card.biggest, round: "regular" })}</span>
              </dd>
            </div>
          )}
          {sundays && (
            <div>
              <dt>On Sundays</dt>
              <dd>{sundayStory(sundays)}</dd>
            </div>
          )}
          <div>
            <dt>All told</dt>
            <dd>
              {card.games} meeting{card.games === 1 ? "" : "s"}
              {card.playoff_games > 0 && `, ${card.playoff_games} in the playoffs`}
              {card.first_season && `, back to ${card.first_season}`}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

const wk = (x: { season: number; week: number }) => `${x.season} week ${x.week}`;

/** "The lead changed hands 7 times in 2 Sundays · Lou came back from 24.1 down, 2026 week 5 · …" */
function sundayStory(s: RivalrySundays): string {
  const parts = [
    `The lead changed hands ${s.leadChanges === 1 ? "once" : `${s.leadChanges} times`} in ${s.meetings} Sunday${s.meetings === 1 ? "" : "s"}`,
  ];
  const c = s.comebacks[0];
  if (c) parts.push(`${c.who} came back from ${c.down.toFixed(1)} down, ${wk(c)}`);
  const m = s.monsters[0];
  if (m) parts.push(`${m.player} had ${m.points.toFixed(1)} for ${m.who}, ${wk(m)}`);
  return parts.join(" · ");
}

const sameGame = (
  a: NonNullable<RivalryCard["biggest"]>,
  b: RivalryCard["last"],
) => !!b && a.season === b.season && a.week === b.week;
