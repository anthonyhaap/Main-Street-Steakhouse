"use client";

/**
 * The Fantasy RedZone feed: what happened today, newest first, and why it
 * mattered to this league.
 *
 * Every card is one row of `sunday_events`, which the server writes once per
 * thing that happened — so the feed never says the same touchdown twice, and
 * a card that is on screen stays on screen when the next refetch lands.
 *
 * The scoring plays carry a Fantasy Impact block: the two sides before the
 * play and after it, and the lead change when it was one. That block is the
 * whole idea — not "Allen scored" but "+6.2 Ray, Ray takes the lead".
 */

import { useState } from "react";
import { LEAGUE_TZ } from "@/lib/config";
import { fmt1 } from "@/lib/scoreboard";
import { eventTag, signed, type SundayEvent } from "@/lib/sunday";

const ago = (iso: string, now: number) => {
  const m = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  // The league's clock, not the machine's: this renders on the server first,
  // and a Sunday-night event must read "Sun" there and in the browser alike.
  return h < 24 ? `${h}h ago` : new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: LEAGUE_TZ });
};

export function EventFeed({ events, now, onMatchup, onGame }: {
  events: SundayEvent[]; now: number;
  onMatchup: (id: string) => void; onGame: (id: string) => void;
}) {
  // The quiet stuff — a catch here, a field goal there — is kept, but behind
  // a switch. The default is the plays that moved something.
  const [all, setAll] = useState(false);
  const quiet = events.filter((e) => e.level === 1).length;
  const shown = all ? events : events.filter((e) => e.level >= 2);

  return (
    <div className="sun-evfeed">
      <div className="sun-sec__head">
        <h2>Today&apos;s feed</h2>
        {quiet > 0 && (
          <button type="button" className="sun-linkbtn" aria-pressed={all} onClick={() => setAll((v) => !v)}>
            {all ? "Big moments only" : `Everything (+${quiet})`}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="sun-quiet">Nothing big yet. Touchdowns, lead changes and close games land here as they happen.</div>
      ) : (
        <div className="sun-feed" role="feed" aria-label="Fantasy RedZone events">
          {shown.map((e) => <EventCard key={e.id} e={e} now={now} onMatchup={onMatchup} onGame={onGame} />)}
        </div>
      )}
    </div>
  );
}

export function EventCard({ e, now, onMatchup, onGame }: {
  e: SundayEvent; now: number;
  onMatchup: (id: string) => void; onGame: (id: string) => void;
}) {
  const play = e.type === "touchdown" || e.type === "big_play" || e.type === "turnover" || e.type === "scoring";
  const who = e.detail.who;
  const opp = e.detail.opp;
  const impact = play && e.old_score != null && e.new_score != null && e.opp_new_score != null && who && opp;

  return (
    <article className="sun-alert sun-event" data-level={e.level} data-kind={e.type} aria-label={e.headline}>
      <span className="sun-alert__tag">
        {e.level >= 3 && <i className="sun-dot" aria-hidden />}
        {eventTag(e)}
        <time className="sun-event__ago" dateTime={e.created_at}>{ago(e.created_at, now)}</time>
      </span>

      {play && e.player_name ? (
        <>
          <span className="sun-alert__head">{e.headline}</span>
          {who && e.points_added != null && (
            <span className="sun-event__pts" data-neg={Number(e.points_added) < 0}>
              {signed(e.points_added)} <b>{who}</b>
            </span>
          )}
        </>
      ) : (
        <>
          <span className="sun-alert__head">{e.headline}</span>
          {e.description && <span className="sun-alert__line">{e.description}</span>}
        </>
      )}

      {impact && (
        <div className="sun-impact" aria-label="Fantasy impact">
          <span className="sun-impact__h">Fantasy impact</span>
          <Board label="Before" a={[who!, Number(e.old_score)]} b={[opp!, Number(e.opp_old_score ?? e.opp_new_score)]} />
          <Board label="After" a={[who!, Number(e.new_score)]} b={[opp!, Number(e.opp_new_score)]} />
        </div>
      )}

      {e.lead_change && play && (
        <span className="sun-event__lead">🔥 {e.description ?? "Lead change"}</span>
      )}

      {e.type === "lead_change" && e.new_score != null && e.opp_new_score != null && who && opp && (
        <span className="sun-alert__line">{who} {fmt1(e.new_score)} — {opp} {fmt1(e.opp_new_score)}</span>
      )}

      {(e.matchup_id || e.nfl_game_id) && e.level >= 2 && (
        <span className="sun-alert__act">
          {e.matchup_id && <button type="button" onClick={() => onMatchup(e.matchup_id!)}>View matchup</button>}
          {e.nfl_game_id && e.type === "red_zone" && <button type="button" onClick={() => onGame(e.nfl_game_id!)}>NFL game</button>}
        </span>
      )}
    </article>
  );
}

/** Two names, two scores, leader first — one line of the impact block. */
function Board({ label, a, b }: { label: string; a: [string, number]; b: [string, number] }) {
  const [first, second] = a[1] >= b[1] ? [a, b] : [b, a];
  return (
    <span className="sun-impact__row">
      <i>{label}</i>
      <span><b>{first[0]}</b> {fmt1(first[1])}</span>
      <span>{second[0]} {fmt1(second[1])}</span>
    </span>
  );
}
