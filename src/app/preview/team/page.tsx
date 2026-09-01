"use client";

/**
 * Fixture harness for the My Team desk. Renders the real components from static
 * data so the layout can be inspected on a wide screen without a session, a
 * completed draft or a live Sunday. Not linked from anywhere.
 *
 * The roster is real: fifteen actual players, their real ESPN ids (which is
 * what makes the headshots and crests load) and their real 2025 game logs,
 * scored under this league's rules — the same numbers `ff_team_hub` returns.
 *
 * The wire is invented, and deliberately so. Injury reports and headlines about
 * real players change by the hour, and a page of stale fabrications about named
 * people is worth nothing to look at and worse than nothing to be believed. The
 * injured names below are made up; they exist to prove the opportunity engine
 * fires — a back ahead of yours going down, a quarterback out, your own starter
 * hurt — and the banner at the top says so.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { TeamDesk, slotOk, type MoveTarget } from "@/components/team/TeamDesk";
import type { HubPlayer, TeamHub, Wire } from "@/lib/nfl/types";

type Seed = {
  name: string; pos: string; team: string; slot: string; espn: string;
  bye: number; rank: number; of: number; adp: number;
  opp: string; home: boolean; kick: string;
  week: number;                       // this week's points
  proj?: number;                      // what he was projected to score
  log: number[];                      // 2025, weeks 1..n
  use: Record<string, number>;
};

const SEEDS: Seed[] = [
  { name: "Patrick Mahomes", pos: "QB", team: "KC", slot: "QB", espn: "3139477", bye: 5, rank: 1, of: 4, adp: 102.5,
    opp: "DEN", home: true, kick: "2026-09-15T00:15:00Z", week: 24.8,
    log: [26.02, 22.08, 13.16, 27.3, 26.72, 31.48, 26.24, 22.96],
    use: { snap_pct: 96.5, pass_att: 35.3, pass_yds: 262.4, tds: 2.63, turnovers: 0.5 } },

  { name: "Jonathan Taylor", pos: "RB", team: "IND", slot: "RB", espn: "4242335", bye: 13, rank: 1, of: 5, adp: 7.5,
    opp: "BAL", home: true, kick: "2026-09-13T17:00:00Z", week: 31.2,
    log: [12.8, 29.5, 32.8, 14.6, 31.6, 23.7, 34.2, 37.4],
    use: { snap_pct: 82.2, carries: 17.9, targets: 3.4, rush_yds: 106.3, rec_yds: 25.8, tds: 1.75 } },

  { name: "Christian McCaffrey", pos: "RB", team: "SF", slot: "RB", espn: "3117251", bye: 8, rank: 1, of: 7, adp: 6.6,
    opp: "LAR", home: false, kick: "2026-09-11T00:35:00Z", week: 18.4,
    log: [23.2, 22.7, 24.0, 26.1, 27.9, 24.1, 39.1, 9.8],
    use: { snap_pct: 85.1, carries: 17.5, targets: 9.3, rush_yds: 61.3, rec_yds: 69.9, tds: 0.75 } },

  { name: "Puka Nacua", pos: "WR", team: "LAR", slot: "WR", espn: "4426515", bye: 11, rank: 1, of: 11, adp: 3.1,
    opp: "SF", home: true, kick: "2026-09-11T00:35:00Z", week: 12.6,
    log: [23.1, 27.6, 22.8, 36.0, 24.5, 4.8],
    use: { snap_pct: 74.7, targets: 10.8, catches: 9.0, rec_yds: 102.7, tds: 0.5 } },

  { name: "Jaxon Smith-Njigba", pos: "WR", team: "SEA", slot: "WR", espn: "4430878", bye: 11, rank: 1, of: 12, adp: 5.5,
    opp: "NE", home: true, kick: "2026-09-10T00:20:00Z", week: 21.3,
    log: [19.4, 18.3, 20.6, 13.0, 27.2, 30.2, 26.3],
    use: { snap_pct: 75.8, targets: 10.0, catches: 7.1, rec_yds: 117.0, tds: 0.57 } },

  { name: "Tucker Kraft", pos: "TE", team: "GB", slot: "TE", espn: "4572680", bye: 11, rank: 1, of: 8, adp: 100.4,
    opp: "MIN", home: false, kick: "2026-09-13T20:25:00Z", week: 9.4,
    log: [9.9, 24.4, 5.9, 10.6, 12.3, 16.8, 33.3],
    use: { snap_pct: 91.3, targets: 5.9, catches: 4.3, rec_yds: 67.0, tds: 0.86 } },

  { name: "Bijan Robinson", pos: "RB", team: "ATL", slot: "FLEX", espn: "4430807", bye: 11, rank: 1, of: 5, adp: 2.2,
    opp: "PIT", home: false, kick: "2026-09-13T17:00:00Z", week: 26.1,
    log: [24.4, 19.8, 16.1, 28.1, 35.8, 21.2, 5.8],
    use: { snap_pct: 74.2, carries: 15.1, targets: 6.0, rush_yds: 78.4, rec_yds: 59.0, tds: 0.57 } },

  { name: "Chris Boswell", pos: "K", team: "PIT", slot: "K", espn: "17372", bye: 9, rank: 1, of: 2, adp: 159.5,
    opp: "ATL", home: true, kick: "2026-09-13T17:00:00Z", week: 11,
    log: [14, 12, 3, 6, 15, 8, 20], use: { fg_made: 2.0 } },

  { name: "Houston Texans", pos: "DST", team: "HOU", slot: "DST", espn: "HOU", bye: 8, rank: 1, of: 1, adp: 98.4,
    opp: "BUF", home: true, kick: "2026-09-13T17:00:00Z", week: 6,
    log: [7, 8, 5, 14, 11, 26, 5], use: { sacks: 2.3 } },

  { name: "Josh Allen", pos: "QB", team: "BUF", slot: "BN", espn: "3918298", bye: 7, rank: 1, of: 3, adp: 34.0,
    opp: "HOU", home: false, kick: "2026-09-13T17:00:00Z", week: 19.4,
    log: [38.76, 11.82, 23.02, 24.86, 19.42, 15.4, 23.22],
    use: { snap_pct: 95.6, pass_att: 28.1, pass_yds: 222.9, carries: 7.0, tds: 2.43, turnovers: 0.71 } },

  { name: "Jahmyr Gibbs", pos: "RB", team: "DET", slot: "BN", espn: "4429795", bye: 6, rank: 1, of: 9, adp: 1.5,
    opp: "NO", home: true, kick: "2026-09-13T17:00:00Z", week: 22.7,
    log: [15.0, 19.4, 26.9, 17.7, 16.7, 7.5, 36.8],
    use: { snap_pct: 61.2, carries: 14.9, targets: 4.0, rush_yds: 75.1, rec_yds: 27.7, tds: 1.0 } },

  { name: "Trey McBride", pos: "TE", team: "ARI", slot: "BN", espn: "4361307", bye: 14, rank: 1, of: 7, adp: 29.0,
    opp: "LAC", home: false, kick: "2026-09-13T20:25:00Z", week: 14.1,
    log: [12.1, 13.8, 15.3, 12.2, 9.1, 21.2, 29.4],
    use: { snap_pct: 91.4, targets: 9.4, catches: 6.7, rec_yds: 60.1, tds: 0.57 } },

  { name: "Ja'Marr Chase", pos: "WR", team: "CIN", slot: "BN", espn: "4362628", bye: 6, rank: 1, of: 12, adp: 3.8,
    opp: "TB", home: true, kick: "2026-09-13T17:00:00Z", week: 28.6,
    log: [4.6, 36.5, 8.9, 7.3, 29.0, 25.1, 38.1, 21.1],
    use: { snap_pct: 94.1, targets: 12.4, catches: 8.8, rec_yds: 90.0, tds: 0.63 } },

  { name: "Amon-Ra St. Brown", pos: "WR", team: "DET", slot: "BN", espn: "4374302", bye: 6, rank: 1, of: 11, adp: 6.4,
    opp: "NO", home: true, kick: "2026-09-13T17:00:00Z", week: 16.2,
    log: [8.5, 39.2, 20.7, 26.0, 18.0, 13.7, 20.6],
    use: { snap_pct: 87.8, targets: 8.7, catches: 7.1, rec_yds: 76.9, tds: 1.0 } },

  { name: "George Pickens", pos: "WR", team: "DAL", slot: "BN", espn: "4426354", bye: 14, rank: 2, of: 14, adp: 20.7,
    opp: "NYG", home: false, kick: "2026-09-14T00:20:00Z", week: 7.8,
    log: [6.0, 17.8, 17.8, 33.4, 13.7, 31.8, 12.2, 14.8],
    use: { snap_pct: 84.8, targets: 7.9, catches: 5.4, rec_yds: 85.6, tds: 0.75 } },
];

const player = (s: Seed, i: number): HubPlayer => {
  const avg = s.log.reduce((a, b) => a + b, 0) / s.log.length;
  const swing = Math.sqrt(s.log.reduce((a, b) => a + (b - avg) ** 2, 0) / (s.log.length - 1));
  const last3 = s.log.slice(-3);
  return {
    player_id: `p${i}`,
    full_name: s.name,
    position: s.pos,
    nfl_team: s.team,
    slot: s.slot,
    status: "ACT",
    bye_week: s.bye,
    locked_at: null,
    locked: false,
    espn_id: s.espn,
    sleeper_id: null,
    points: s.week,
    projection: s.proj ?? Math.round((s.log.reduce((a, b) => a + b, 0) / s.log.length) * 10) / 10,
    projected_at: new Date().toISOString(),
    stats_updated_at: new Date().toISOString(),
    on_bye: false,
    game: { opponent: s.opp, home: s.home, kickoff_at: s.kick, status: "pre", status_detail: null },
    depth: { rank: s.rank, of: s.of, overall_rank: Math.round(s.adp), adp: s.adp },
    form: {
      season: 2025,
      games: s.log.length,
      avg_points: round(avg),
      last3_avg: round(last3.reduce((a, b) => a + b, 0) / last3.length),
      best: Math.max(...s.log),
      worst: Math.min(...s.log),
      total: round(s.log.reduce((a, b) => a + b, 0)),
      swing: round(swing),
      booms: s.log.filter((p) => p >= 15).length,
      busts: s.log.filter((p) => p < 5).length,
      game_log: s.log.map((points, w) => ({ week: w + 1, points })),
      usage: s.use,
    },
  };
};

const round = (n: number) => Math.round(n * 100) / 100;

const ROSTER = SEEDS.map(player);
const STARTERS = ROSTER.filter((p) => p.slot !== "BN");

const HUB: TeamHub = {
  team: { id: "t1", name: "Gridiron Butchers", league_id: "L", owner_email: null, draft_slot: 1 },
  league: {
    id: "L", name: "Main Street Steakhouse", season: 2026,
    roster_slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST",
                   "BN", "BN", "BN", "BN", "BN", "BN"],
    current_week: 1,
  },
  week: 1,
  form_season: 2025,
  roster: ROSTER,
  record: { wins: 4, losses: 2, ties: 0, points_for: 812.4, points_against: 741.9, rank: 3, teams: 12 },
  matchup: {
    id: "m1", home: true,
    my_points: round(STARTERS.reduce((a, p) => a + p.points, 0)),
    opp_points: 148.2,
    opponent: { id: "t7", name: "Dry Aged Dynasty", record: { wins: 5, losses: 1, ties: 0 } },
  },
  splits: {
    starter_points: round(STARTERS.reduce((a, p) => a + p.points, 0)),
    bench_points: round(ROSTER.filter((p) => p.slot === "BN").reduce((a, p) => a + p.points, 0)),
    projected_starters: round(STARTERS.reduce((a, p) => a + (p.projection ?? 0), 0)),
    by_position: ["QB", "RB", "WR", "TE", "K", "DST"].map((pos) => {
      const group = STARTERS.filter((p) => p.position === pos);
      return {
        position: pos,
        players: group.length,
        points: round(group.reduce((a, p) => a + p.points, 0)),
        avg_form: group.length ? round(group.reduce((a, p) => a + (p.form?.avg_points ?? 0), 0) / group.length) : null,
      };
    }).filter((s) => s.players > 0),
  },
  generated_at: new Date().toISOString(),
};

/** Invented reports on invented players — enough to fire every rule once. */
const WIRE: Wire = {
  fetchedAt: new Date(Date.now() - 42 * 60000).toISOString(),
  articles: [
    {
      id: "a1", headline: "Colts lean on Taylor as backfield thins out",
      description: "Indianapolis ruled out a second running back on Friday, leaving the workload where it has been all month.",
      published_at: new Date(Date.now() - 42 * 60000).toISOString(),
      url: null, byline: "Fixture", image_url: null, image_alt: null,
      athletes: [{ id: "4242335", name: "Jonathan Taylor" }], teams: ["IND"],
    },
    {
      id: "a2", headline: "Rams list Nacua as questionable with an ankle",
      description: "He was limited in practice Thursday and Friday but travelled with the team.",
      published_at: new Date(Date.now() - 3 * 3600000).toISOString(),
      url: null, byline: "Fixture", image_url: null, image_alt: null,
      athletes: [{ id: "4426515", name: "Puka Nacua" }], teams: ["LAR"],
    },
    {
      id: "a3", headline: "Seahawks turn to their backup under center",
      description: "A short week and a long injury report leave Seattle starting the second quarterback on the depth chart.",
      published_at: new Date(Date.now() - 7 * 3600000).toISOString(),
      url: null, byline: "Fixture", image_url: null, image_alt: null,
      athletes: [], teams: ["SEA"],
    },
    {
      id: "a4", headline: "Around the league: five games with playoff weight",
      description: "A look at the Sunday slate and what each result would do to the picture.",
      published_at: new Date(Date.now() - 11 * 3600000).toISOString(),
      url: null, byline: "Fixture", image_url: null, image_alt: null,
      athletes: [], teams: ["BAL", "KC"],
    },
  ],
  injuries: [
    { id: "i1", espn_athlete_id: "900001", player_id: null, name: "Ray Alcott",
      position: "RB", team: "IND", status: "Out", severity: "out", detail: "Hamstring",
      location: "Leg", comment: "Ruled out Friday.", return_date: null,
      reported_at: new Date().toISOString() },
    // Matched to a roster player by id — the rule that says "your own man is hurt".
    { id: "i2", espn_athlete_id: "4426515", player_id: "p3", name: "Puka Nacua",
      position: "WR", team: "LAR", status: "Questionable", severity: "questionable",
      detail: "Ankle", location: "Leg", comment: "Limited in practice Thursday and Friday.",
      return_date: null, reported_at: new Date().toISOString() },
    { id: "i3", espn_athlete_id: "900002", player_id: null, name: "Dell Whitaker",
      position: "QB", team: "SEA", status: "Out", severity: "out", detail: "Shoulder",
      location: "Arm", comment: null, return_date: null,
      reported_at: new Date().toISOString() },
    { id: "i4", espn_athlete_id: "900003", player_id: null, name: "Marcus Vane",
      position: "WR", team: "GB", status: "Out", severity: "out", detail: "Concussion",
      location: "Head", comment: "Did not clear protocol.", return_date: null,
      reported_at: new Date().toISOString() },
  ],
};

export default function TeamPreviewPage() {
  const [hub, setHub] = useState<TeamHub>(HUB);
  const [moving, setMoving] = useState<HubPlayer | null>(null);

  /** Swap in local state so the lineup interaction is real to click through. */
  function drop(target: MoveTarget) {
    if (!moving) return;
    if (!slotOk(target.slot, moving.position)) return;
    setHub((h) => ({
      ...h,
      roster: h.roster.map((p) =>
        p.player_id === moving.player_id ? { ...p, slot: target.slot }
        : target.player && p.player_id === target.player.player_id ? { ...p, slot: moving.slot }
        : p),
    }));
    setMoving(null);
  }

  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> Real players and real 2025 stat lines; the injury
        reports and headlines are invented for layout, and the injured names are not
        real people.
      </div>
      <TeamDesk
        hub={hub}
        wire={WIRE}
        moving={moving}
        busy={false}
        onPickUp={setMoving}
        onCancelMove={() => setMoving(null)}
        onDrop={drop}
        onWeek={() => {}}
      />
    </>
  );
}
