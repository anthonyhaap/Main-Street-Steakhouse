/**
 * Real NFL imagery, addressed rather than stored.
 *
 * ESPN serves club logos and player headshots from a public CDN at stable,
 * id-addressable URLs. We already carry the ids those URLs need: club
 * abbreviations in `players.nfl_team`, and ESPN athlete ids in
 * `player_id_map` (source `espn`, or `espn_team` for a team defense, whose
 * "id" is the club abbreviation). So a roster row can show the actual face and
 * the actual crest without an image pipeline, an API key or a byte of storage.
 *
 * Every one of these can 404 — a rookie without a headshot on file, a club
 * abbreviation we don't know. Callers render through <NflImage>, which swaps in
 * a monogram when the load fails, so a missing image is never a broken box.
 */

import { NFL_TEAMS, normTeam } from "@/lib/nfl/teams";

const CDN = "https://a.espncdn.com";

/** Club crest. `size` is the CDN's own bucket: 500 is the largest served. */
export function teamLogo(abbr: string | null | undefined, size: 500 | 100 = 500): string | null {
  const key = normTeam(abbr);
  if (!key) return null;
  return `${CDN}/i/teamlogos/nfl/${size}/${NFL_TEAMS[key].espn}.png`;
}

/**
 * Player headshot. A team defense has no face, so its "ESPN id" is the club
 * abbreviation and we hand back the crest instead — which is what every other
 * fantasy site shows for a DST anyway.
 */
export function headshot(espnId: string | null | undefined): string | null {
  if (!espnId) return null;
  const id = String(espnId).trim();
  if (!id) return null;
  if (!/^\d+$/.test(id)) return teamLogo(id);
  return `${CDN}/i/headshots/nfl/players/full/${id}.png`;
}

/** The club's colour, at an alpha low enough to sit behind text. */
export function teamWash(abbr: string | null | undefined, alpha = "14"): string {
  const key = normTeam(abbr);
  return key ? `${NFL_TEAMS[key].color}${alpha}` : "transparent";
}

export function teamColor(abbr: string | null | undefined): string | null {
  const key = normTeam(abbr);
  return key ? NFL_TEAMS[key].color : null;
}
