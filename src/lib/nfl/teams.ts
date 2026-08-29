/**
 * The 32 clubs, keyed the way our database keys them (`players.nfl_team`,
 * `nfl_games.home_team`). Everything visual about a real NFL team on this site
 * resolves through here: its logo, its colour, and the short name we print.
 *
 * `espn` is the abbreviation ESPN uses in URLs and feeds, which is *not* always
 * ours — Washington is WAS to us and WSH to them, and ESPN answers to both LA
 * and LAR for the Rams. `ALIASES` folds their spelling back onto ours so a wire
 * story about the "WSH" backfield still lands on the Commanders' running back.
 */

export type NflTeam = {
  /** Our abbreviation — the primary key. */
  abbr: string;
  name: string;
  /** What fits in a badge: "Commanders", not "Washington Commanders". */
  nick: string;
  /** ESPN's abbreviation; also the logo filename. */
  espn: string;
  /** Primary club colour, used for hairlines and washes, never for text. */
  color: string;
};

export const NFL_TEAMS: Record<string, NflTeam> = {
  ARI: { abbr: "ARI", name: "Arizona Cardinals",      nick: "Cardinals",  espn: "ari", color: "#97233f" },
  ATL: { abbr: "ATL", name: "Atlanta Falcons",        nick: "Falcons",    espn: "atl", color: "#a71930" },
  BAL: { abbr: "BAL", name: "Baltimore Ravens",       nick: "Ravens",     espn: "bal", color: "#241773" },
  BUF: { abbr: "BUF", name: "Buffalo Bills",          nick: "Bills",      espn: "buf", color: "#00338d" },
  CAR: { abbr: "CAR", name: "Carolina Panthers",      nick: "Panthers",   espn: "car", color: "#0085ca" },
  CHI: { abbr: "CHI", name: "Chicago Bears",          nick: "Bears",      espn: "chi", color: "#0b162a" },
  CIN: { abbr: "CIN", name: "Cincinnati Bengals",     nick: "Bengals",    espn: "cin", color: "#fb4f14" },
  CLE: { abbr: "CLE", name: "Cleveland Browns",       nick: "Browns",     espn: "cle", color: "#311d00" },
  DAL: { abbr: "DAL", name: "Dallas Cowboys",         nick: "Cowboys",    espn: "dal", color: "#041e42" },
  DEN: { abbr: "DEN", name: "Denver Broncos",         nick: "Broncos",    espn: "den", color: "#fb4f14" },
  DET: { abbr: "DET", name: "Detroit Lions",          nick: "Lions",      espn: "det", color: "#0076b6" },
  GB:  { abbr: "GB",  name: "Green Bay Packers",      nick: "Packers",    espn: "gb",  color: "#203731" },
  HOU: { abbr: "HOU", name: "Houston Texans",         nick: "Texans",     espn: "hou", color: "#03202f" },
  IND: { abbr: "IND", name: "Indianapolis Colts",     nick: "Colts",      espn: "ind", color: "#002c5f" },
  JAX: { abbr: "JAX", name: "Jacksonville Jaguars",   nick: "Jaguars",    espn: "jax", color: "#006778" },
  KC:  { abbr: "KC",  name: "Kansas City Chiefs",     nick: "Chiefs",     espn: "kc",  color: "#e31837" },
  LAC: { abbr: "LAC", name: "Los Angeles Chargers",   nick: "Chargers",   espn: "lac", color: "#0080c6" },
  LAR: { abbr: "LAR", name: "Los Angeles Rams",       nick: "Rams",       espn: "lar", color: "#003594" },
  LV:  { abbr: "LV",  name: "Las Vegas Raiders",      nick: "Raiders",    espn: "lv",  color: "#000000" },
  MIA: { abbr: "MIA", name: "Miami Dolphins",         nick: "Dolphins",   espn: "mia", color: "#008e97" },
  MIN: { abbr: "MIN", name: "Minnesota Vikings",      nick: "Vikings",    espn: "min", color: "#4f2683" },
  NE:  { abbr: "NE",  name: "New England Patriots",   nick: "Patriots",   espn: "ne",  color: "#002244" },
  NO:  { abbr: "NO",  name: "New Orleans Saints",     nick: "Saints",     espn: "no",  color: "#d3bc8d" },
  NYG: { abbr: "NYG", name: "New York Giants",        nick: "Giants",     espn: "nyg", color: "#0b2265" },
  NYJ: { abbr: "NYJ", name: "New York Jets",          nick: "Jets",       espn: "nyj", color: "#125740" },
  PHI: { abbr: "PHI", name: "Philadelphia Eagles",    nick: "Eagles",     espn: "phi", color: "#004c54" },
  PIT: { abbr: "PIT", name: "Pittsburgh Steelers",    nick: "Steelers",   espn: "pit", color: "#ffb612" },
  SEA: { abbr: "SEA", name: "Seattle Seahawks",       nick: "Seahawks",   espn: "sea", color: "#002244" },
  SF:  { abbr: "SF",  name: "San Francisco 49ers",    nick: "49ers",      espn: "sf",  color: "#aa0000" },
  TB:  { abbr: "TB",  name: "Tampa Bay Buccaneers",   nick: "Buccaneers", espn: "tb",  color: "#d50a0a" },
  TEN: { abbr: "TEN", name: "Tennessee Titans",       nick: "Titans",     espn: "ten", color: "#0c2340" },
  WAS: { abbr: "WAS", name: "Washington Commanders",  nick: "Commanders", espn: "wsh", color: "#5a1414" },
};

/** Spellings other feeds use, folded onto ours. */
const ALIASES: Record<string, string> = {
  WSH: "WAS", WFT: "WAS", LA: "LAR", STL: "LAR", SD: "LAC",
  OAK: "LV", JAC: "JAX", ARZ: "ARI", CLV: "CLE", HST: "HOU", BLT: "BAL",
};

/** Normalise any abbreviation — ours, ESPN's or Sleeper's — to our key. */
export function normTeam(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  const up = abbr.trim().toUpperCase();
  const key = ALIASES[up] ?? up;
  return NFL_TEAMS[key] ? key : null;
}

export function team(abbr: string | null | undefined): NflTeam | null {
  const key = normTeam(abbr);
  return key ? NFL_TEAMS[key] : null;
}

/** Full club name → our abbreviation. ESPN's injury feed groups by name only. */
const BY_NAME: Record<string, string> = Object.fromEntries(
  Object.values(NFL_TEAMS).flatMap((t) => [
    [t.name.toLowerCase(), t.abbr],
    [t.nick.toLowerCase(), t.abbr],
  ]),
);

export function teamByName(name: string | null | undefined): string | null {
  if (!name) return null;
  return BY_NAME[name.trim().toLowerCase()] ?? null;
}
