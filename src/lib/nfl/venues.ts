/**
 * Where the 32 clubs play, and whether the sky can reach the field.
 *
 * Weather is the one lineup input the database has never held: `nfl_games`
 * knows who plays whom and when, and nothing about where. It does not need to —
 * a fixture's location is a property of the home club, and home clubs move
 * stadium about once a decade. So this is a static table rather than a column,
 * and the forecast is looked up against it by the home team's abbreviation.
 *
 * `roof` is the field that actually matters, and it has three states rather
 * than two:
 *
 *   dome        — sealed. The forecast is irrelevant and is not applied.
 *   retractable — a roof the club can close, and closes when the weather is
 *                 bad, which is exactly when the forecast would have mattered.
 *                 We cannot know their decision, so the effect is halved.
 *   open        — the forecast lands on the game in full.
 *
 * SoFi is filed as a dome: its canopy is fixed, it keeps the rain out and the
 * wind down, and for a lineup decision that is what a dome means. Seattle and
 * Miami are open — their roofs cover seats, not the field.
 */

import { normTeam } from "@/lib/nfl/teams";

export type Roof = "dome" | "retractable" | "open";

export type Venue = {
  /** The home club's abbreviation, as `players.nfl_team` spells it. */
  club: string;
  name: string;
  /** City and state, for the sentence under a forecast. */
  city: string;
  lat: number;
  lon: number;
  roof: Roof;
};

export const VENUES: Record<string, Venue> = {
  ARI: { club: "ARI", name: "State Farm Stadium",        city: "Glendale, AZ",      lat: 33.5276, lon: -112.2626, roof: "retractable" },
  ATL: { club: "ATL", name: "Mercedes-Benz Stadium",     city: "Atlanta, GA",       lat: 33.7554, lon:  -84.4008, roof: "retractable" },
  BAL: { club: "BAL", name: "M&T Bank Stadium",          city: "Baltimore, MD",     lat: 39.2780, lon:  -76.6227, roof: "open" },
  BUF: { club: "BUF", name: "Highmark Stadium",          city: "Orchard Park, NY",  lat: 42.7738, lon:  -78.7870, roof: "open" },
  CAR: { club: "CAR", name: "Bank of America Stadium",   city: "Charlotte, NC",     lat: 35.2258, lon:  -80.8528, roof: "open" },
  CHI: { club: "CHI", name: "Soldier Field",             city: "Chicago, IL",       lat: 41.8623, lon:  -87.6167, roof: "open" },
  CIN: { club: "CIN", name: "Paycor Stadium",            city: "Cincinnati, OH",    lat: 39.0955, lon:  -84.5161, roof: "open" },
  CLE: { club: "CLE", name: "Huntington Bank Field",     city: "Cleveland, OH",     lat: 41.5061, lon:  -81.6995, roof: "open" },
  DAL: { club: "DAL", name: "AT&T Stadium",              city: "Arlington, TX",     lat: 32.7473, lon:  -97.0945, roof: "retractable" },
  DEN: { club: "DEN", name: "Empower Field at Mile High", city: "Denver, CO",       lat: 39.7439, lon: -105.0201, roof: "open" },
  DET: { club: "DET", name: "Ford Field",                city: "Detroit, MI",       lat: 42.3400, lon:  -83.0456, roof: "dome" },
  GB:  { club: "GB",  name: "Lambeau Field",             city: "Green Bay, WI",     lat: 44.5013, lon:  -88.0622, roof: "open" },
  HOU: { club: "HOU", name: "NRG Stadium",               city: "Houston, TX",       lat: 29.6847, lon:  -95.4107, roof: "retractable" },
  IND: { club: "IND", name: "Lucas Oil Stadium",         city: "Indianapolis, IN",  lat: 39.7601, lon:  -86.1639, roof: "retractable" },
  JAX: { club: "JAX", name: "EverBank Stadium",          city: "Jacksonville, FL",  lat: 30.3239, lon:  -81.6373, roof: "open" },
  KC:  { club: "KC",  name: "Arrowhead Stadium",         city: "Kansas City, MO",   lat: 39.0489, lon:  -94.4839, roof: "open" },
  LAC: { club: "LAC", name: "SoFi Stadium",              city: "Inglewood, CA",     lat: 33.9535, lon: -118.3392, roof: "dome" },
  LAR: { club: "LAR", name: "SoFi Stadium",              city: "Inglewood, CA",     lat: 33.9535, lon: -118.3392, roof: "dome" },
  LV:  { club: "LV",  name: "Allegiant Stadium",         city: "Las Vegas, NV",     lat: 36.0909, lon: -115.1833, roof: "dome" },
  MIA: { club: "MIA", name: "Hard Rock Stadium",         city: "Miami Gardens, FL", lat: 25.9580, lon:  -80.2389, roof: "open" },
  MIN: { club: "MIN", name: "U.S. Bank Stadium",         city: "Minneapolis, MN",   lat: 44.9738, lon:  -93.2578, roof: "dome" },
  NE:  { club: "NE",  name: "Gillette Stadium",          city: "Foxborough, MA",    lat: 42.0909, lon:  -71.2643, roof: "open" },
  NO:  { club: "NO",  name: "Caesars Superdome",         city: "New Orleans, LA",   lat: 29.9511, lon:  -90.0812, roof: "dome" },
  NYG: { club: "NYG", name: "MetLife Stadium",           city: "East Rutherford, NJ", lat: 40.8135, lon: -74.0745, roof: "open" },
  NYJ: { club: "NYJ", name: "MetLife Stadium",           city: "East Rutherford, NJ", lat: 40.8135, lon: -74.0745, roof: "open" },
  PHI: { club: "PHI", name: "Lincoln Financial Field",   city: "Philadelphia, PA",  lat: 39.9008, lon:  -75.1675, roof: "open" },
  PIT: { club: "PIT", name: "Acrisure Stadium",          city: "Pittsburgh, PA",    lat: 40.4468, lon:  -80.0158, roof: "open" },
  SEA: { club: "SEA", name: "Lumen Field",               city: "Seattle, WA",       lat: 47.5952, lon: -122.3316, roof: "open" },
  SF:  { club: "SF",  name: "Levi's Stadium",            city: "Santa Clara, CA",   lat: 37.4033, lon: -121.9694, roof: "open" },
  TB:  { club: "TB",  name: "Raymond James Stadium",     city: "Tampa, FL",         lat: 27.9759, lon:  -82.5033, roof: "open" },
  TEN: { club: "TEN", name: "Nissan Stadium",            city: "Nashville, TN",     lat: 36.1665, lon:  -86.7713, roof: "open" },
  WAS: { club: "WAS", name: "Northwest Stadium",         city: "Landover, MD",      lat: 38.9077, lon:  -76.8645, roof: "open" },
};

/** The venue a club hosts in, tolerant of another feed's spelling. */
export const venue = (abbr: string | null | undefined): Venue | null => {
  const key = normTeam(abbr);
  return key ? VENUES[key] ?? null : null;
};

/* --------------------------------------------------------------- forecast -- */
/**
 * What `/api/weather` returns per stadium. The shape lives here, next to the
 * table it is looked up in, so the route handler that fills it in never has to
 * reach into a client module for a type.
 */

export type WeatherState =
  /** A real reading for the hour of kickoff. */
  | "forecast"
  /** Sealed roof. The forecast does not reach the field. */
  | "indoors"
  /** Kickoff is past the forecast horizon. */
  | "too_far"
  /** We asked and got nothing back. */
  | "unavailable";

export type GameWeather = {
  /** The home club — the venue is his. */
  club: string;
  venue: string;
  city: string;
  roof: Roof;
  kickoff_at: string;
  state: WeatherState;
  temp_f: number | null;
  feels_f: number | null;
  wind_mph: number | null;
  gust_mph: number | null;
  /** Percent. */
  precip_chance: number | null;
  /** Inches in the kickoff hour. */
  precip_in: number | null;
  snow_in: number | null;
  /** WMO code, for the word we print. */
  code: number | null;
};
