"use client";

/**
 * Fixture harness for the scoreboard. Not linked from anywhere.
 *
 * The live page needs a session, a completed draft and a week with rosters in
 * it, which is why this screen went unlooked-at for so long. The players and
 * their ESPN ids are real; the teams, scores and lineups are invented, and the
 * managers are not real people.
 */

import { TopBar } from "@/components/Shell";
import { Scoreboard } from "@/components/Scoreboard";
import type { Matchup, RosterPoint, Team } from "@/lib/types";

const LEAGUE = "L";
const MY_TEAM = "t3";

const TEAMS: Team[] = [
  ["t1", "Prime Cut", "Marcus"], ["t2", "Gridiron Butchers", "Anthony"],
  ["t3", "The Porterhouse", "Ray"], ["t4", "Dry Aged Dynasty", "Dev"],
  ["t5", "Bone-In Bandits", "Tom"], ["t6", "Wagyu Warriors", "Nate"],
].map(([id, name, manager], i) => ({
  id, league_id: LEAGUE, name, owner_email: null, owner_id: null,
  draft_slot: i + 1, manager_name: manager,
} as unknown as Team));

/** name, position, club, ESPN id — all real. */
const POOL: [string, string, string, string][] = [
  ["Patrick Mahomes", "QB", "KC", "3139477"], ["Josh Allen", "QB", "BUF", "3918298"],
  ["Jahmyr Gibbs", "RB", "DET", "4429795"], ["Bijan Robinson", "RB", "ATL", "4430807"],
  ["Christian McCaffrey", "RB", "SF", "3117251"], ["Jonathan Taylor", "RB", "IND", "4242335"],
  ["De'Von Achane", "RB", "MIA", "4429160"], ["Puka Nacua", "WR", "LAR", "4426515"],
  ["Ja'Marr Chase", "WR", "CIN", "4362628"], ["Jaxon Smith-Njigba", "WR", "SEA", "4430878"],
  ["Amon-Ra St. Brown", "WR", "DET", "4374302"], ["Drake London", "WR", "ATL", "4426502"],
  ["Trey McBride", "TE", "ARI", "4361307"], ["Tucker Kraft", "TE", "GB", "4572680"],
  ["Chris Boswell", "K", "PIT", "16339"], ["Brandon Aubrey", "K", "DAL", "4249087"],
];

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST"];

/** FLEX draws from the running backs; every other slot takes its own position,
    so a QB row is a real quarterback rather than whoever the offset landed on. */
const forSlot = (slot: string) => POOL.filter(([, pos]) => pos === (slot === "FLEX" ? "RB" : slot));

/** A lineup is nine rows off the pool, offset per team so no two look alike.
    Nobody is picked twice — FLEX and RB draw from the same players, and a
    lineup starting one man in two slots would be a fixture nobody believes. */
function lineup(teamId: string, offset: number, week: number): RosterPoint[] {
  const used = new Set<string>();
  return SLOTS.map((slot, i) => {
    // DST first: the pool holds no defenses, so forSlot("DST") is empty and
    // indexing it would hand back undefined.
    const eligible = slot === "DST" ? [] : forSlot(slot);
    let pick: [string, string, string, string] = ["Houston Texans", "DST", "HOU", "HOU"];
    if (eligible.length) {
      pick = eligible[(offset + i) % eligible.length];
      for (let n = 1; used.has(pick[0]) && n < eligible.length; n++) {
        pick = eligible[(offset + i + n) % eligible.length];
      }
      used.add(pick[0]);
    }
    const [full_name, position, nfl_team, espn_id] = pick;
    // Deterministic so the fixture never flickers between renders.
    const pts = Math.round(((offset * 7 + i * 13) % 23) * 1.4 * 10) / 10;
    return {
      team_id: teamId, week, slot, player_id: `${teamId}-${i}`,
      full_name: full_name.trim(), position, nfl_team, league_id: LEAGUE,
      points: pts, locked_at: null, stats_updated_at: null, espn_id,
    };
  });
}

const PAIRS: [string, string][] = [["t1", "t2"], ["t3", "t4"], ["t5", "t6"]];

const POINTS: RosterPoint[] = PAIRS.flatMap(([a, b], p) => [
  ...lineup(a, p * 3 + 1, 11),
  ...lineup(b, p * 3 + 5, 11),
]);

const total = (id: string) =>
  Math.round(POINTS.filter((r) => r.team_id === id).reduce((s, r) => s + r.points, 0) * 10) / 10;

const MATCHUPS: Matchup[] = PAIRS.map(([away, home], i) => ({
  id: `m${i}`, league_id: LEAGUE, week: 11,
  away_team_id: away, home_team_id: home,
  away_points: total(away), home_points: total(home),
} as unknown as Matchup));

export default function MatchupsPreviewPage() {
  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> Week 11 with three games. Real players and real ESPN
        ids; the teams, scores and lineups are invented. Expand a card to see the
        lineups — every name is a badge, as it is everywhere else.
      </div>
      <main className="page" data-width="mid">
        <Scoreboard matchups={MATCHUPS} points={POINTS} teams={TEAMS} myTeamId={MY_TEAM} />
      </main>
    </>
  );
}
