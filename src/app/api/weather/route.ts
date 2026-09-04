import { NextResponse, type NextRequest } from "next/server";
import { venue, type GameWeather } from "@/lib/nfl/venues";

export const runtime = "nodejs";

/**
 * The forecast over each of this week's stadiums, at kickoff.
 *
 * Everything else the lineup coach reads comes out of our own tables. Weather
 * does not: nobody in the league is going to run a cron for it, and a forecast
 * two hours stale is worth as much as a fresh one. So it is fetched on demand,
 * here rather than in the browser, for three reasons that all matter:
 *
 *   — the client never picks the coordinates. It names clubs; the venue table
 *     turns those into a latitude. There is no shape of query string that
 *     turns this into a proxy for somewhere else.
 *   — one upstream call covers every stadium on the slate, and Next's fetch
 *     cache holds it for half an hour, so a league of twelve managers opening
 *     the coach on a Sunday morning is one request to Open-Meteo, not twelve.
 *   — a forecast that fails is not an error worth showing. It comes back as an
 *     absent reading and the coach says so.
 *
 * Open-Meteo is used without a key and asks for attribution, which the coach
 * carries. Its forecast reaches sixteen days out; a week further away than
 * that is reported as `too_far`, not guessed at.
 */

const UPSTREAM = "https://api.open-meteo.com/v1/forecast";

const HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "snowfall",
  "wind_speed_10m",
  "wind_gusts_10m",
  "weather_code",
].join(",");

/** Open-Meteo's window: yesterday through sixteen days out. */
const HORIZON_DAYS = 16;

type Hourly = {
  time: string[];
  temperature_2m: (number | null)[];
  apparent_temperature: (number | null)[];
  precipitation_probability: (number | null)[];
  precipitation: (number | null)[];
  snowfall: (number | null)[];
  wind_speed_10m: (number | null)[];
  wind_gusts_10m: (number | null)[];
  weather_code: (number | null)[];
};

export async function GET(request: NextRequest) {
  // "BUF@2026-09-13T17:00:00Z" — a club and the kickoff we want the hour for.
  const asked = request.nextUrl.searchParams.getAll("g").slice(0, 20);

  const wanted = new Map<string, { kickoff: Date }>();
  for (const raw of asked) {
    const at = raw.indexOf("@");
    if (at < 1) continue;
    const spot = venue(raw.slice(0, at));
    const kickoff = new Date(raw.slice(at + 1));
    if (!spot || Number.isNaN(kickoff.getTime())) continue;
    if (!wanted.has(spot.club)) wanted.set(spot.club, { kickoff });
  }

  if (wanted.size === 0) {
    return NextResponse.json({ games: {}, fetched_at: new Date().toISOString() });
  }

  const games: Record<string, GameWeather> = {};

  // A sealed roof needs no forecast, and a kickoff outside the model's horizon
  // has none to give. Both are answers, so they are reported rather than
  // dropped — "we did not look" and "we looked and could not see" are different
  // things to tell a manager.
  const now = Date.now();
  const outdoors: { club: string; kickoff: Date }[] = [];

  for (const [club, { kickoff }] of wanted) {
    const spot = venue(club)!;
    const days = (kickoff.getTime() - now) / 86_400_000;

    if (spot.roof === "dome") {
      games[club] = base(club, kickoff, "indoors");
    } else if (days > HORIZON_DAYS || days < -1) {
      games[club] = base(club, kickoff, "too_far");
    } else {
      outdoors.push({ club, kickoff });
    }
  }

  if (outdoors.length > 0) {
    try {
      const readings = await forecast(outdoors);
      for (const [club, reading] of readings) games[club] = reading;
      for (const { club, kickoff } of outdoors) {
        if (!games[club]) games[club] = base(club, kickoff, "unavailable");
      }
    } catch {
      for (const { club, kickoff } of outdoors) games[club] = base(club, kickoff, "unavailable");
    }
  }

  return NextResponse.json(
    { games, fetched_at: new Date().toISOString() },
    { headers: { "cache-control": "private, max-age=900" } },
  );
}

/** A reading with no numbers in it — the roof, or the horizon, is the answer. */
function base(club: string, kickoff: Date, state: GameWeather["state"]): GameWeather {
  const spot = venue(club)!;
  return {
    club,
    venue: spot.name,
    city: spot.city,
    roof: spot.roof,
    kickoff_at: kickoff.toISOString(),
    state,
    temp_f: null,
    feels_f: null,
    wind_mph: null,
    gust_mph: null,
    precip_chance: null,
    precip_in: null,
    snow_in: null,
    code: null,
  };
}

async function forecast(spots: { club: string; kickoff: Date }[]): Promise<Map<string, GameWeather>> {
  const venues = spots.map((s) => venue(s.club)!);

  // One call for the whole slate. Open-Meteo answers a list of coordinates with
  // a list of results in the same order — and a single coordinate with a bare
  // object, which is the shape that bites you when a slate has one open-air
  // game left in it.
  const times = spots.map((s) => s.kickoff.getTime());
  const url = new URL(UPSTREAM);
  url.searchParams.set("latitude", venues.map((v) => v.lat).join(","));
  url.searchParams.set("longitude", venues.map((v) => v.lon).join(","));
  url.searchParams.set("hourly", HOURLY);
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("start_date", day(Math.min(...times)));
  url.searchParams.set("end_date", day(Math.max(...times)));

  const response = await fetch(url, {
    // Half an hour. Forecasts are re-cut hourly upstream, and a lineup decision
    // does not turn on a wind reading that moved by one mile an hour.
    next: { revalidate: 1800 },
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`open-meteo ${response.status}`);

  const body = (await response.json()) as { hourly?: Hourly } | { hourly?: Hourly }[];
  const list = Array.isArray(body) ? body : [body];

  const out = new Map<string, GameWeather>();
  for (const [i, { club, kickoff }] of spots.entries()) {
    const hourly = list[i]?.hourly;
    if (!hourly?.time?.length) continue;

    const at = nearestHour(hourly.time, kickoff);
    if (at === -1) continue;

    out.set(club, {
      ...base(club, kickoff, "forecast"),
      temp_f: num(hourly.temperature_2m?.[at]),
      feels_f: num(hourly.apparent_temperature?.[at]),
      wind_mph: num(hourly.wind_speed_10m?.[at]),
      gust_mph: num(hourly.wind_gusts_10m?.[at]),
      precip_chance: num(hourly.precipitation_probability?.[at]),
      precip_in: num(hourly.precipitation?.[at]),
      snow_in: num(hourly.snowfall?.[at]),
      code: num(hourly.weather_code?.[at]),
    });
  }
  return out;
}

/** UTC calendar day, which is what `start_date` means with `timezone=UTC`. */
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The hourly row closest to kickoff. Open-Meteo returns "2026-09-13T17:00"
 * without a zone marker and means UTC, because that is what we asked for.
 */
function nearestHour(times: string[], kickoff: Date): number {
  const target = kickoff.getTime();
  let best = -1;
  let gap = Infinity;
  for (const [i, t] of times.entries()) {
    const ms = Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(t) ? t : `${t}Z`);
    if (Number.isNaN(ms)) continue;
    const d = Math.abs(ms - target);
    if (d < gap) {
      gap = d;
      best = i;
    }
  }
  // More than three hours from the kickoff is not this game's weather.
  return gap <= 3 * 3_600_000 ? best : -1;
}
