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

export function Rivalry({ card, me }: {
  card: RivalryCard;
  /** The reading manager, when he is one of the two. Changes the wording. */
  me?: string | null;
}) {
  const [open, setOpen] = useState(false);

  // Two managers who have never met is a real answer, but it is not worth a
  // row on a scoreboard: the card would be a sentence saying there is nothing
  // to say. It stays silent until there is a record.
  if (card.games === 0) return null;

  const detail = card.last || card.biggest || card.playoff_games > 0;

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

const sameGame = (
  a: NonNullable<RivalryCard["biggest"]>,
  b: RivalryCard["last"],
) => !!b && a.season === b.season && a.week === b.week;
