"use client";

/**
 * The front page, on a game day.
 *
 * Tonight's Table already answers "who am I playing and am I winning". On a
 * day with football it needs two more things, and they are what this file
 * adds under the card:
 *
 *   Today      who plays today — mine by name, his by name — from the
 *              briefing alone: Thursday night's receiver, Monday's tight end,
 *              Sunday morning's eight
 *   Live       the latest thing that happened in my game, its moment, what
 *              the rest of the league is doing, and the door to the game
 *              center — from `ff_sunday`, the game center's own payload
 *
 * The live half is a second call and only made on a day it can say
 * something: football on, or today's slate still to come. Every other day
 * of the week the front page is exactly what it was.
 */

import Link from "next/link";
import { useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LEAGUE_TZ } from "@/lib/config";
import { useLive } from "@/lib/live";
import { loadSunday } from "@/lib/sunday-load";
import { fmt, fmtKick, leagueDay, playingToday, who, type Briefing, type BriefStarter, type Phase } from "@/lib/briefing";
import { sundayPhase, type SundayBoard } from "@/lib/sunday";
import { latestFor, leaguePulse, matchupMoment, nextUp, seatOf } from "@/lib/gameday";
import { LeaguePulse, MomentBox, StoryCard } from "@/components/sunday/GameDay";
import "@/components/sunday/sunday.css";

/* ------------------------------------------------------------------ today -- */

export function PlayingToday({ b, now, phase }: { b: Briefing; now: number; phase: Phase }) {
  // Live and Monday already list who is left, on the card itself.
  if (phase !== "lineup" && phase !== "preseason" && phase !== "waivers") return null;
  const { mine, theirs } = playingToday(b, now);
  if (mine.length + theirs.length === 0 || !b.matchup) return null;
  // The day's first kickoff on either side of the table, not just mine: an
  // afternoon game of his makes it "Today", whatever time mine kicks.
  const first = [mine[0], theirs[0]].filter(Boolean).map((p) => p.kickoff_at!).sort()[0];
  const evening = new Intl.DateTimeFormat("en-US", { timeZone: LEAGUE_TZ, hour: "numeric", hourCycle: "h23" })
    .format(new Date(first));
  const label = Number(evening) >= 18 ? "Tonight" : "Today";
  const names = (s: BriefStarter[]) =>
    s.length === 0 ? "nobody" : s.length > 3 ? `${s.slice(0, 3).map((p) => p.full_name).join(", ")} +${s.length - 3}` : s.map((p) => p.full_name).join(", ");
  return (
    <section className="today" aria-label={`${label}'s players`}>
      <span className="eyebrow" data-tone="gold">{label} · from {fmtKick(first)}</span>
      <p><b>You:</b> {names(mine)}</p>
      <p><b>{who(b.matchup.opponent)}:</b> {names(theirs)}</p>
    </section>
  );
}

/* ------------------------------------------------------------------- live -- */

/** Whether the front page should ask for the game center's payload at all. */
export function wantsLive(b: Briefing, phase: Phase, now: number): boolean {
  if (phase === "live" || phase === "monday" || phase === "settled") return true;
  const next = b.games.next_kickoff;
  return !!next && leagueDay(next) === leagueDay(now) && phase === "lineup";
}

export function HomeGameDay({ b, now, phase, enabled }: { b: Briefing; now: number; phase: Phase; enabled: boolean }) {
  const on = enabled && wantsLive(b, phase, now);
  const fetcher = useCallback(() => loadSunday(supabaseBrowser(), null), []);
  // Events are the signal that matters here; the card above already watches
  // the scores. A minute's poll is the net under realtime, not the engine.
  const { data } = useLive<SundayBoard>(fetcher, {
    tables: ["sunday_events"], channel: "home-gameday", pollMs: 60000, enabled: on,
  });
  if (!on || !data) return null;
  return <HomeGameDayView board={data} now={now} />;
}

/** Pure: the panel from a board and a clock, so the preview can show it. */
export function HomeGameDayView({ board, now }: { board: SundayBoard; now: number }) {
  const phase = sundayPhase(board, now);
  const seat = seatOf(board);
  const events = board.events ?? [];
  const pulse = leaguePulse(board, now, 4);
  const latest = seat ? latestFor(events, seat.card.id, now, 90) : null;
  const moment = seat ? matchupMoment(seat.card, events, board.nfl ?? [], now) : null;
  const next = nextUp(board, now);
  const live = (board.games?.in_progress ?? 0) > 0;

  if (phase === "pre") {
    if (!next) return null;
    const g = next.game;
    return (
      <section className="sun-mini home-gd" aria-label="Game day">
        <div className="home-gd__head">
          <span className="gd-eyebrow">Game day</span>
          <Link href="/sunday" className="home-gd__cta">Game Center <ArrowRight size={14} aria-hidden /></Link>
        </div>
        <p className="home-gd__lede">
          First up: <b>{g.away} @ {g.home}</b>, {next.label}
          {next.ours > 0 ? ` — ${next.ours} Steakhouse player${next.ours === 1 ? "" : "s"} in it.` : "."}
        </p>
      </section>
    );
  }

  return (
    <section className="sun-mini home-gd" data-live={live} aria-label="Live from the Steakhouse">
      <div className="home-gd__head">
        <span className="gd-eyebrow">{live && <i className="sun-dot" aria-hidden />} {phase === "final" ? "The day, finished" : "Live now"}</span>
        <Link href="/sunday" className="home-gd__cta">{phase === "final" ? "The recap" : "Open Game Center"} <ArrowRight size={14} aria-hidden /></Link>
      </div>
      {moment && <MomentBox m={moment} />}
      {latest && (
        <div className="home-gd__latest">
          <span className="home-gd__label">Latest in your matchup</span>
          <StoryCard e={latest} now={now} />
        </div>
      )}
      {!live && next && phase === "live" && (
        <p className="home-gd__lede">Between windows. Next kickoff {next.label}.</p>
      )}
      <LeaguePulse items={pulse} phase={phase} compact />
      {seat && (
        <Link className="home-gd__mine" href={`/matchups/${seat.card.id}?week=${seat.card.week}`}>
          {live ? "View live matchup" : "Full matchup"} · {who(seat.me)} {fmt(seat.me.points)} — {who(seat.them)} {fmt(seat.them.points)}
        </Link>
      )}
    </section>
  );
}
