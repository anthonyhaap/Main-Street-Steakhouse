/**
 * The opportunity engine.
 *
 * A wire full of league news is noise until it is read against *your* roster.
 * The thing a manager actually wants to know on a Sunday morning is not "who
 * gothurt" — it is "what does that do to my lineup". Two teams' worth of injury
 * reports are one line of value: the starter ahead of your back is out, so his
 * carries are your carries.
 *
 * So this is a pure function: roster in, ranked notes out. No fetching, no
 * state, no rendering. That makes the judgement calls below — who counts as a
 * beneficiary, what counts as a downgrade, which note outranks which — the only
 * thing in the file, and testable on their own.
 *
 * The rules, in the order they fire:
 *
 *   1. A player of yours is himself on the report → that is the headline, and
 *      the only note that can start a lineup change. Never dressed up as good
 *      news.
 *   2. A teammate at the same position is out → the touches move. An RB's
 *      carries, a receiver's targets. Weighted by how far up the depth chart
 *      the absence goes: the RB1 going down matters, the RB4 does not.
 *   3. The quarterback throwing to your receiver is out → a downgrade, because
 *      target volume survives a QB change and efficiency does not.
 *   4. Your player is on bye, or has no game this week → a scheduling fact
 *      worth as much as any injury and cheaper to act on.
 *
 * Every note carries the player it concerns so the UI can put a face on it.
 */

import type { HubPlayer, WireArticle, WireInjury } from "@/lib/nfl/types";
import { team as clubOf } from "@/lib/nfl/teams";

export type InsightKind = "alert" | "boost" | "downgrade" | "schedule";

export type Insight = {
  id: string;
  kind: InsightKind;
  /** Sort key. Higher is more worth the manager's attention. */
  weight: number;
  headline: string;
  detail: string;
  /** The player of yours this is about. */
  player: HubPlayer;
  /** The other player who caused it, when there is one. */
  cause?: { name: string; position: string | null; team: string | null; status: string; espnId: string | null };
};

/** Positions whose touches flow to the same position group when one is out. */
const SHARES: Record<string, string[]> = {
  RB: ["RB"],
  WR: ["WR", "TE"],
  TE: ["WR", "TE"],
};

const WORD: Record<string, string> = {
  RB: "carries",
  WR: "targets",
  TE: "targets",
};

const OUT: WireInjury["severity"][] = ["out", "doubtful"];

/** "Colts", not "IND" — these sentences are read, not scanned. */
const clubName = (abbr: string | null | undefined) => clubOf(abbr)?.nick ?? abbr ?? "his club";

const volumeNote = (p: HubPlayer): string | null => {
  const u = p.form?.usage;
  if (!u) return null;
  if (p.position === "RB" && u.carries) return `He is at ${u.carries} carries a game`;
  if ((p.position === "WR" || p.position === "TE") && u.targets) return `He is at ${u.targets} targets a game`;
  return null;
};

export function buildInsights(roster: HubPlayer[], injuries: WireInjury[], week: number): Insight[] {
  const notes: Insight[] = [];
  const mine = new Set(roster.map((p) => p.espn_id).filter(Boolean));

  // Index the report by club once; every rule below is a lookup, not a scan.
  const byClub = new Map<string, WireInjury[]>();
  for (const inj of injuries) {
    if (!inj.team) continue;
    const list = byClub.get(inj.team);
    if (list) list.push(inj);
    else byClub.set(inj.team, [inj]);
  }

  for (const p of roster) {
    const club = p.nfl_team ? byClub.get(p.nfl_team) ?? [] : [];

    // --- 1. your own guy is hurt ---------------------------------------
    const self = club.find((i) => i.espnId && i.espnId === p.espn_id);
    if (self && self.severity !== "probable") {
      const starting = p.slot !== "BN";
      notes.push({
        id: `self-${p.player_id}`,
        kind: "alert",
        weight: (self.severity === "out" ? 100 : self.severity === "doubtful" ? 90 : 70) + (starting ? 10 : 0),
        headline: `${p.full_name} is ${self.status.toLowerCase()}`,
        detail: [
          self.detail ? `${self.detail}.` : null,
          starting ? `He is in your ${p.slot} slot.` : "He is on your bench.",
          self.comment,
        ].filter(Boolean).join(" "),
        player: p,
        cause: { name: self.name, position: self.position, team: self.team, status: self.status, espnId: self.espnId },
      });
    }

    // --- 2. the room around him just changed ---------------------------
    const shares = SHARES[p.position] ?? [];
    if (shares.length && !self) {
      for (const inj of club) {
        if (!OUT.includes(inj.severity)) continue;
        if (inj.espnId && inj.espnId === p.espn_id) continue;
        if (mine.has(inj.espnId ?? "")) continue;
        if (!inj.position || !shares.includes(inj.position)) continue;

        // Only an absence *ahead of* your player frees up work. Without a depth
        // rank we assume it might, at a lower weight, rather than staying quiet.
        const ahead = p.depth.rank == null || p.depth.rank > 1;
        const sameSpot = inj.position === p.position;

        notes.push({
          id: `boost-${p.player_id}-${inj.id}`,
          kind: "boost",
          weight: (sameSpot ? 60 : 45) + (ahead ? 10 : 0) + (p.slot !== "BN" ? 5 : 0) +
                  (inj.severity === "out" ? 5 : 0),
          headline: `${inj.name} is ${inj.status.toLowerCase()} — ${p.full_name} sees more work`,
          detail: [
            `${inj.position} ${inj.name} is ${inj.status.toLowerCase()} for the ${clubName(inj.team)}${inj.detail ? ` (${inj.detail})` : ""}.`,
            `Those ${WORD[p.position] ?? "touches"} have to go somewhere, and ${p.full_name} is`,
            p.depth.rank && p.depth.of
              ? `the ${p.position}${p.depth.rank} of ${p.depth.of} on the roster.`
              : `on the same depth chart.`,
            volumeNote(p) ? `${volumeNote(p)} — expect more.` : "",
          ].filter(Boolean).join(" "),
          player: p,
          cause: { name: inj.name, position: inj.position, team: inj.team, status: inj.status, espnId: inj.espnId },
        });
      }
    }

    // --- 3. the man throwing him the ball is out -----------------------
    if (["WR", "TE", "RB"].includes(p.position) && !self) {
      const qb = club.find((i) => i.position === "QB" && OUT.includes(i.severity) && !mine.has(i.espnId ?? ""));
      if (qb) {
        notes.push({
          id: `qb-${p.player_id}-${qb.id}`,
          kind: "downgrade",
          weight: 40 + (p.slot !== "BN" ? 8 : 0),
          headline: `${qb.name} is ${qb.status.toLowerCase()} — that lands on ${p.full_name}`,
          detail: `The ${clubName(p.nfl_team)} go to a backup at quarterback${qb.detail ? ` (${qb.detail})` : ""}. Volume usually holds; efficiency usually doesn't.`,
          player: p,
          cause: { name: qb.name, position: qb.position, team: qb.team, status: qb.status, espnId: qb.espnId },
        });
      }
    }

    // --- 4. he isn't playing at all ------------------------------------
    if (p.slot !== "BN") {
      if (p.on_bye) {
        notes.push({
          id: `bye-${p.player_id}`,
          kind: "schedule",
          weight: 95,
          headline: `${p.full_name} is on bye`,
          detail: `The ${clubName(p.nfl_team)} don't play in week ${week}. Started, he scores zero.`,
          player: p,
        });
      } else if (!p.game) {
        notes.push({
          id: `nogame-${p.player_id}`,
          kind: "schedule",
          weight: 85,
          headline: `No week ${week} game for ${p.full_name}`,
          detail: p.nfl_team
            ? `We have no ${clubName(p.nfl_team)} game on the schedule this week.`
            : `He isn't on an NFL roster right now.`,
          player: p,
        });
      }
    }
  }

  // One note per player per cause; the heaviest wins where they collide.
  const seen = new Set<string>();
  return notes
    .sort((a, b) => b.weight - a.weight)
    .filter((n) => {
      const key = `${n.player.player_id}:${n.cause?.espnId ?? n.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The stories that are actually about your team, newest first: anything filed
 * under one of your players, or under a club you hold a starter from.
 */
export function myNews(roster: HubPlayer[], articles: WireArticle[]) {
  const byEspn = new Map(roster.filter((p) => p.espn_id).map((p) => [p.espn_id!, p]));
  const clubs = new Set(roster.map((p) => p.nfl_team).filter((t): t is string => !!t));

  return articles
    .map((a) => {
      const players = a.athletes.map((x) => byEspn.get(x.id)).filter((p): p is HubPlayer => !!p);
      const clubHit = a.teams.filter((t) => clubs.has(t));
      return { article: a, players, clubs: clubHit };
    })
    .filter((r) => r.players.length > 0 || r.clubs.length > 0)
    .sort((a, b) => {
      // A story about your player beats a story about his club.
      if (a.players.length !== b.players.length) return b.players.length - a.players.length;
      return Date.parse(b.article.published ?? "") - Date.parse(a.article.published ?? "");
    });
}
