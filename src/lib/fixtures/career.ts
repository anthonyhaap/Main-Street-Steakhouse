import type { CareerEvent } from "@/lib/sundayline";

/**
 * A few weeks of stored Sundays for the previews that read careers: the wall's
 * profiles (/preview/history) and the rivalry cards (/preview/matchups).
 *
 * Written as the detector writes them — the team that did it on `team_id`, the
 * other side on `opponent_team_id`, the names in `detail.who` / `detail.opp` —
 * and keyed by whatever team ids the preview's own league uses, so one script
 * of Sundays can be told in either.
 */
export type CareerScript = [
  week: number,
  kind: "lead" | "late" | "td" | "comeback" | "monster",
  team: string, opp: string,
  extra?: { down?: number; points?: number; player?: string },
][];

export function careerEvents(script: CareerScript, name: (teamId: string) => string, season = 2026): CareerEvent[] {
  return script.map(([week, kind, team, opp, x = {}], i) => {
    const who = name(team), against = name(opp);
    const base = {
      id: `ce-${i}`, season, week, level: 3 as CareerEvent["level"], team_id: team, opponent_team_id: opp,
      matchup_id: `cm-${week}-${[team, opp].sort().join("-")}`, lead_change: false,
      created_at: new Date(Date.UTC(season, 8, 7 + week * 7, 19, i)).toISOString(),
    };
    switch (kind) {
      case "lead": case "late":
        return { ...base, type: "lead_change", lead_change: true, level: kind === "late" ? 4 : 3,
          headline: `${who} takes the lead over ${against}`, detail: { who, opp: against, late: kind === "late" } };
      case "td":
        return { ...base, type: "touchdown", lead_change: true, headline: `${x.player ?? "Somebody"} — receiving touchdown`,
          detail: { who, opp: against, late: false } };
      case "comeback":
        return { ...base, type: "comeback", lead_change: true, level: 4, headline: `${who} comes back on ${against}`,
          detail: { who, opp: against, down: x.down ?? 20 } };
      case "monster":
        return { ...base, type: "monster_game", headline: `${x.player ?? "Somebody"} — monster game`,
          detail: { who, opp: against, points: x.points ?? 30 } };
    }
  });
}
