"use client";

import { useEffect, useState } from "react";
import type { HubPlayer } from "@/lib/nfl/types";
import { normTeam } from "@/lib/nfl/teams";
import type { GameWeather, Roof } from "@/lib/nfl/venues";

export type { GameWeather, WeatherState } from "@/lib/nfl/venues";

/**
 * What the sky is doing over each of this week's stadiums, and what that is
 * worth in points.
 *
 * The reading itself comes from `/api/weather`, which is where the venue
 * coordinates live. This file is the half a manager argues about: how much a
 * twenty mile an hour wind is actually worth, and to whom.
 *
 * The rules below are deliberately small and deliberately asymmetric, because
 * the effect is. Wind is the one condition with a large, repeatable, one-way
 * effect on scoring, and it lands almost entirely on the passing game and the
 * kicker — a forty yard field goal into a gale is a different kick, and a deep
 * ball is a different throw. Rain and snow do less than television implies.
 * Cold on its own does almost nothing until it is severe. And every one of
 * those conditions nudges a game towards the run, which is why the back's
 * multiplier goes the other way.
 *
 * Nothing here is worth more than a fifth of a projection either way. Weather
 * is a tiebreaker between two close starts, not a reason to bench your best
 * player, and the model should not be able to pretend otherwise.
 */

/** Club abbreviation of whoever is hosting → the forecast over that field. */
export type WeatherMap = Map<string, GameWeather>;

/* ------------------------------------------------------------------ fetch -- */

/** Who hosts a player's game: himself at home, the other club away. */
export const hostOf = (p: HubPlayer): string | null =>
  p.game ? normTeam(p.game.home ? p.nfl_team : p.game.opponent) : null;

/**
 * The forecast for every stadium this roster plays in.
 *
 * Not `useLive`: there is no table to watch and no realtime channel to join,
 * and the answer moves on the hour rather than on the second. One request per
 * roster and week, repeated when either changes.
 */
export function useWeather(roster: HubPlayer[] | null, enabled = true) {
  // The query string is the dependency: same stadiums at the same kickoffs,
  // same request. A refetched hub that changed nothing re-renders without
  // going back out to the network.
  const query = roster ? gamesQuery(roster) : "";

  // The answer is held with the question that produced it. That is what makes
  // it safe to keep a forecast across a re-render and still never hand out
  // last week's wind for this week's game: a reading whose query no longer
  // matches is simply not returned.
  const [held, setHeld] = useState<{ query: string; weather: WeatherMap } | null>(null);

  useEffect(() => {
    if (!enabled || !query) return;
    const abort = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/weather?${query}`, { signal: abort.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { games: Record<string, GameWeather> };
        if (!abort.signal.aborted) {
          setHeld({ query, weather: new Map(Object.entries(body.games ?? {})) });
        }
      } catch {
        // A missing forecast is a state the coach knows how to draw, not an
        // error to put in front of anybody.
        if (!abort.signal.aborted) setHeld({ query, weather: new Map() });
      }
    })();

    return () => abort.abort();
  }, [query, enabled]);

  return { weather: held && held.query === query ? held.weather : null };
}

function gamesQuery(roster: HubPlayer[]): string {
  const seen = new Map<string, string>();
  for (const p of roster) {
    const host = hostOf(p);
    if (host && p.game?.kickoff_at && !seen.has(host)) seen.set(host, p.game.kickoff_at);
  }
  const params = new URLSearchParams();
  for (const [club, kickoff] of [...seen].sort()) params.append("g", `${club}@${kickoff}`);
  return params.toString();
}

/* ------------------------------------------------------------- judgement -- */

/** How much of the forecast reaches the field. */
const EXPOSURE: Record<Roof, number> = {
  open: 1,
  // A club with a roof closes it when the weather is bad, which is exactly when
  // this would have mattered. Split the difference rather than guess.
  retractable: 0.5,
  dome: 0,
};

/** Who the passing game's weather belongs to. */
const THROWN = new Set(["QB", "WR", "TE"]);

export type WeatherRead = {
  /** Multiplier on a projection. 1 means the weather is not worth a point. */
  mult: number;
  /** "18 mph wind" — the chip. */
  label: string;
  /** The sentence under it. */
  detail: string;
};

/**
 * What this forecast is worth to this position.
 *
 * Returns null when there is nothing to say — indoors, a clear afternoon, or no
 * reading at all — so a caller can tell "the weather does not matter here" from
 * "the weather is fine here", and print neither.
 */
export function weatherRead(position: string, w: GameWeather | null | undefined): WeatherRead | null {
  if (!w) return null;

  if (w.state === "indoors") {
    return { mult: 1, label: "Indoors", detail: `${w.venue} is a sealed roof — no weather in this one.` };
  }
  if (w.state !== "forecast") return null;

  const exposure = EXPOSURE[w.roof];
  if (exposure === 0) return null;

  const wind = w.wind_mph ?? 0;
  const gust = Math.max(w.gust_mph ?? 0, wind);
  const rain = w.precip_in ?? 0;
  const chance = w.precip_chance ?? 0;
  const snow = w.snow_in ?? 0;
  const temp = w.temp_f ?? 60;

  const passing = THROWN.has(position);
  const kicking = position === "K";
  const running = position === "RB";
  const defense = position === "DST";

  // Everything below is a fraction of the projection, positive meaning better.
  let effect = 0;
  const said: string[] = [];

  // --- wind ---------------------------------------------------------------
  // Nothing under 12 mph is worth a word. Above it the cost climbs with every
  // gust, and it is the kicker who pays most.
  if (wind >= 12) {
    const over = (wind - 12) / 5 + Math.max(0, gust - 22) / 12;
    if (kicking) effect -= 0.055 * over;
    else if (passing) effect -= 0.035 * over;
    else if (running) effect += 0.014 * over;
    else if (defense) effect += 0.012 * over;
    said.push(`${Math.round(wind)} mph wind${gust >= wind + 6 ? `, gusting ${Math.round(gust)}` : ""}`);
  }

  // --- what is falling ----------------------------------------------------
  if (snow >= 0.04) {
    if (kicking) effect -= 0.09;
    else if (passing) effect -= 0.06;
    else if (running) effect += 0.025;
    else if (defense) effect += 0.03;
    said.push("snow at kickoff");
  } else if (rain >= 0.02 || chance >= 60) {
    const heavy = rain >= 0.1;
    if (kicking) effect -= heavy ? 0.05 : 0.02;
    else if (passing) effect -= heavy ? 0.04 : 0.015;
    else if (running) effect += heavy ? 0.02 : 0.008;
    else if (defense) effect += heavy ? 0.02 : 0.008;
    said.push(heavy ? "heavy rain" : `rain likely (${Math.round(chance)}%)`);
  }

  // --- cold ---------------------------------------------------------------
  // Cold on its own is mostly folklore until it is genuinely severe.
  if (temp <= 20) {
    if (kicking) effect -= 0.05;
    else if (passing) effect -= 0.03;
    said.push(`${Math.round(temp)}°F`);
  }

  if (said.length === 0) return null;

  const half = w.roof === "retractable"
    ? " The roof retracts, so the club may close it — this counts half."
    : "";

  return {
    mult: clamp(1 + effect * exposure, 0.8, 1.2),
    label: sentence(said[0]),
    detail: `${sentence(said.join(", "))} at ${w.venue}.${half}`,
  };
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ words -- */

/** WMO weather codes, in the coarse buckets a manager cares about. */
export function skyWord(w: GameWeather): string {
  if (w.state === "indoors") return "Indoors";
  if (w.state === "too_far") return "Too far out";
  if (w.state !== "forecast" || w.code == null) return "No reading";
  const c = w.code;
  if (c >= 95) return "Thunderstorms";
  if (c >= 71 && c <= 86) return "Snow";
  if (c >= 61) return "Rain";
  if (c >= 51) return "Drizzle";
  if (c >= 45) return "Fog";
  if (c >= 2) return "Cloud";
  return "Clear";
}
