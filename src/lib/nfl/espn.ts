/**
 * The league wire: real NFL news and real injury reports, from ESPN's public
 * feeds — the same ones that back espn.com/nfl.
 *
 * Why this file exists at all, rather than a `fetch` in a component:
 *
 *   * It runs on the server. The feeds don't promise CORS headers, and a
 *     browser fetch would be at the mercy of that. A route handler also lets
 *     Next cache one response for everyone instead of twelve managers each
 *     hitting ESPN on every tab focus.
 *
 *   * It normalises. The upstream JSON is deep, optional almost everywhere and
 *     not ours to control. Every field below is read through a narrowing helper
 *     and every list tolerates a missing branch, so a shape change upstream
 *     costs us a thinner wire, never a crashed page.
 *
 *   * It fails soft, per feed. News and injuries are fetched independently and
 *     the response reports which one answered. Half a wire is still worth
 *     drawing; a silent empty one is not.
 *
 * Nothing here is stored. We hold ids, headlines and links, and point at ESPN's
 * own images and articles — attribution intact, no scraping, no mirror.
 */

import type { Wire, WireArticle, WireInjury } from "@/lib/nfl/types";
import { normTeam, teamByName } from "@/lib/nfl/teams";

const NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50";
const INJURY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";

/** Seconds a wire response is reused before ESPN is asked again. */
export const WIRE_TTL = 300;

/* ------------------------------------------------------------- narrowing -- */

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
};

/** Walk a path of keys, stopping at the first thing that isn't an object. */
const dig = (v: unknown, ...path: string[]): unknown => {
  let cur: unknown = v;
  for (const key of path) {
    const o = obj(cur);
    if (!o) return undefined;
    cur = o[key];
  }
  return cur;
};

async function getJson(url: string, revalidate: number): Promise<unknown> {
  const res = await fetch(url, {
    // ESPN serves these anonymously; the UA is courtesy, not authentication.
    headers: { accept: "application/json", "user-agent": "MainStreetSteakhouseLeague/1.0" },
    signal: AbortSignal.timeout(8000),
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ------------------------------------------------------------------ news -- */

function toArticle(raw: unknown, i: number): WireArticle | null {
  const a = obj(raw);
  if (!a) return null;

  const headline = str(a.headline) ?? str(a.title);
  if (!headline) return null;

  const url = str(dig(a, "links", "web", "href")) ?? str(dig(a, "links", "mobile", "href"));

  // ESPN files each story under "categories": one entry per athlete, team or
  // league it concerns. That index is the whole reason this page can say "this
  // story is about *your* running back" instead of showing a generic feed.
  const athletes: WireArticle["athletes"] = [];
  const teams = new Set<string>();
  for (const c of arr(a.categories)) {
    const cat = obj(c);
    if (!cat) continue;
    const kind = str(cat.type);
    if (kind === "athlete") {
      const id = str(cat.athleteId) ?? str(dig(cat, "athlete", "id"));
      const name = str(dig(cat, "athlete", "description")) ?? str(cat.description);
      if (id) athletes.push({ id, name: name ?? "" });
    } else if (kind === "team") {
      const club =
        teamByName(str(dig(cat, "team", "description"))) ??
        normTeam(str(dig(cat, "team", "abbreviation"))) ??
        teamByName(str(cat.description));
      if (club) teams.add(club);
    }
  }

  const img = obj(arr(a.images)[0]);
  const imgUrl = img ? str(img.url) : null;

  return {
    id: str(a.id) ?? str(a.dataSourceIdentifier) ?? url ?? `${headline}-${i}`,
    headline,
    description: str(a.description) ?? "",
    published: str(a.published) ?? str(a.lastModified),
    url,
    byline: str(a.byline),
    image: imgUrl
      ? { url: imgUrl, alt: str(img?.caption) ?? str(img?.alt) ?? headline }
      : null,
    athletes,
    teams: [...teams],
  };
}

async function fetchNews(revalidate: number): Promise<WireArticle[]> {
  const body = obj(await getJson(NEWS_URL, revalidate));
  return arr(body?.articles)
    .map(toArticle)
    .filter((a): a is WireArticle => a !== null);
}

/* -------------------------------------------------------------- injuries -- */

/**
 * ESPN words a status a dozen ways ("Out", "Injured Reserve", "Day-To-Day").
 * The UI and the opportunity engine both need a coarse bucket instead, so the
 * prose is read exactly once, here.
 */
function severity(status: string): WireInjury["severity"] {
  const s = status.toLowerCase();
  if (
    s.includes("injured reserve") || s.includes("physically unable") ||
    s.includes("non football") || s.includes("suspension") || s.includes("suspended") ||
    s === "out" || s.startsWith("out")
  ) return "out";
  if (s.includes("doubtful")) return "doubtful";
  if (s.includes("questionable") || s.includes("day-to-day") || s.includes("day to day")) return "questionable";
  if (s.includes("probable") || s.includes("active")) return "probable";
  return "unknown";
}

function toInjury(raw: unknown, club: string | null, i: number): WireInjury | null {
  const n = obj(raw);
  if (!n) return null;

  const athlete = obj(n.athlete);
  const name = str(athlete?.displayName) ?? str(athlete?.fullName) ?? str(n.displayName);
  if (!name) return null;

  const status =
    str(n.status) ?? str(dig(n, "type", "description")) ?? str(dig(n, "details", "type")) ?? "Unknown";

  const team =
    club ??
    normTeam(str(dig(athlete, "team", "abbreviation"))) ??
    teamByName(str(dig(athlete, "team", "displayName")));

  return {
    id: str(n.id) ?? `${name}-${i}`,
    espnId: str(athlete?.id),
    name,
    position: str(dig(athlete, "position", "abbreviation")) ?? str(dig(athlete, "position", "name")),
    team,
    status,
    severity: severity(status),
    detail:
      str(dig(n, "details", "detail")) ??
      str(dig(n, "details", "type")) ??
      str(dig(n, "details", "location")),
    comment: str(n.shortComment) ?? str(n.longComment),
    returnDate: str(dig(n, "details", "returnDate")),
    updated: str(n.date),
  };
}

async function fetchInjuries(revalidate: number): Promise<WireInjury[]> {
  const body = obj(await getJson(INJURY_URL, revalidate));
  const out: WireInjury[] = [];

  // The feed nests one club per entry, each holding that club's report. The
  // club is only named in full there, so it is carried down to each row.
  for (const groupRaw of arr(body?.injuries)) {
    const group = obj(groupRaw);
    if (!group) continue;
    const club =
      teamByName(str(group.displayName)) ??
      normTeam(str(group.abbreviation)) ??
      teamByName(str(group.name));

    const rows = arr(group.injuries);
    // Some responses put the report one level down under `items`.
    const list = rows.length ? rows : arr(group.items);
    for (const [i, row] of list.entries()) {
      const injury = toInjury(row, club, i);
      if (injury) out.push(injury);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ wire -- */

export async function fetchWire(revalidate = WIRE_TTL): Promise<Wire> {
  const [news, injuries] = await Promise.allSettled([
    fetchNews(revalidate),
    fetchInjuries(revalidate),
  ]);

  const reason = (r: PromiseRejectedResult) =>
    r.reason instanceof Error ? r.reason.message : String(r.reason);

  return {
    fetchedAt: new Date().toISOString(),
    articles: news.status === "fulfilled" ? news.value : [],
    injuries: injuries.status === "fulfilled" ? injuries.value : [],
    sources: [
      { name: "news", ok: news.status === "fulfilled", ...(news.status === "rejected" && { error: reason(news) }) },
      { name: "injuries", ok: injuries.status === "fulfilled", ...(injuries.status === "rejected" && { error: reason(injuries) }) },
    ],
  };
}
