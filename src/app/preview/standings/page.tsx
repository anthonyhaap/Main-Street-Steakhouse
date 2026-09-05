"use client";

/**
 * Fixture harness for the standings board. A mid-season league with a real
 * spread of records, so the playoff odds, clinch badges and cut lines can be
 * inspected without a session or a database. Not linked from anywhere.
 *
 * The switch also renders the state the board spends its whole preseason in:
 * twelve undrafted teams, where the simulation has nothing to separate them
 * and the odds are withheld rather than printed as twelve coin flips.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { StandingsBoard } from "@/components/StandingsBoard";
import { mulberry32 } from "@/lib/playoffs";
import type { Outlook, OutlookMatchup, OutlookTeam } from "@/lib/types";

const NAMES = [
  "Gridiron Butchers", "Prime Cut", "Dry Aged Dynasty", "The Porterhouse",
  "Bone-In Bandits", "Wagyu Warriors", "Tomahawk Chop", "Filet Force",
  "Sirloin Syndicate", "Ribeye Renegades", "Brisket Brigade", "Chuck Wagon",
];
const MANAGERS = [
  "Anthony", "Marcus", "Dev", "Ray", "Tom", "Nate", "Jules", "Sam", "Kai", "Priya", "Owen", null,
];

function build(): Outlook {
  const rand = mulberry32(7);
  const week = 11;
  const regular = 14;
  const ids = NAMES.map((_, i) => `t${i + 1}`);
  const strength = NAMES.map((_, i) => 98 + (11 - i) * 2.4 + rand() * 6);
  const at = (id: string) => ids.indexOf(id);
  const r1 = (n: number) => Math.round(n * 10) / 10;

  const matchups: OutlookMatchup[] = [];
  let rot = [...ids];
  for (let w = 1; w <= regular; w++) {
    for (let i = 0; i < 6; i++) {
      const a = rot[i], b = rot[11 - i];
      const [home, away] = w % 2 === 0 ? [b, a] : [a, b];
      const played = w < week;
      matchups.push({
        id: `m${w}-${i}`, week: w, home_team_id: home, away_team_id: away,
        home_points: played ? r1(strength[at(home)] + (rand() - 0.5) * 44) : 0,
        away_points: played ? r1(strength[at(away)] + (rand() - 0.5) * 44) : 0,
        played,
      });
    }
    rot = [rot[0], rot[11], ...rot.slice(1, 11)];
  }

  const teams: OutlookTeam[] = ids.map((id, i) => {
    const mine = matchups.filter((m) => m.played && (m.home_team_id === id || m.away_team_id === id));
    const scores = mine.map((m) => (m.home_team_id === id ? m.home_points : m.away_points));
    const against = mine.map((m) => (m.home_team_id === id ? m.away_points : m.home_points));
    const sum = (xs: number[]) => r1(xs.reduce((s, x) => s + x, 0));
    return {
      id, name: NAMES[i], manager_name: MANAGERS[i],
      wins: scores.filter((s, k) => s > against[k]).length,
      losses: scores.filter((s, k) => s < against[k]).length,
      ties: 0,
      points_for: sum(scores), points_against: sum(against),
      scores, proj_ppg: r1(strength[i]),
    };
  });

  return {
    week, regular_season_weeks: regular, playoff_teams: 6, playoff_byes: 2,
    teams, matchups, generated_at: new Date().toISOString(),
  };
}

const outlook = build();

/** The same league before the draft: no results, no rosters to project. */
function preseason(): Outlook {
  return {
    ...outlook,
    week: 1,
    teams: outlook.teams.map((t) => ({
      ...t, wins: 0, losses: 0, ties: 0,
      points_for: 0, points_against: 0, scores: [], proj_ppg: null,
    })),
    matchups: outlook.matchups.map((m) => ({
      ...m, played: false, home_points: 0, away_points: 0,
    })),
  };
}

const BEFORE = preseason();

export default function Preview() {
  const [drafted, setDrafted] = useState(true);
  return (
    <>
      <TopBar status="live" />
      <main className="page">
        <div className="segmented" style={{ width: "max-content" }}>
          <button className="segmented__opt" data-on={!drafted} onClick={() => setDrafted(false)}>
            Before the draft
          </button>
          <button className="segmented__opt" data-on={drafted} onClick={() => setDrafted(true)}>
            Week 11
          </button>
        </div>
        <StandingsBoard outlook={drafted ? outlook : BEFORE} myTeamId="t4" />
      </main>
    </>
  );
}
