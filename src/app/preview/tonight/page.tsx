"use client";

/**
 * Fixture harness for Tonight's Table. Not linked from anywhere.
 *
 * The same card, every day of the week: pick a day and the fixture moves the
 * clock and the slate, and the card changes personality the way it does at
 * the real URL. The teams, managers, scores and history are invented; the
 * player names are real players used as lineup rows.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { TonightsTable } from "@/components/tonight/TonightsTable";
import { Carousel } from "@/components/tonight/Carousel";
import { phaseOf, type Briefing, type BriefStarter } from "@/lib/briefing";

const T = (id: string, name: string, manager: string | null) => ({ id, name, manager_name: manager, logo_path: null });
const TEAMS = [
  T("t1", "Gridiron Butchers", "Anthony Haap"), T("t2", "Prime Cut", "Marcus"), T("t3", "Dry Aged Dynasty", "Dev"),
  T("t4", "The Porterhouse", "Dave Porter"), T("t5", "Bone-In Bandits", "Tom"), T("t6", "Wagyu Warriors", "Nate"),
  T("t7", "Tomahawk Chop", "Jules"), T("t8", "Filet Force", "Sam"), T("t9", "Sirloin Syndicate", "Kai"),
  T("t10", "Ribeye Renegades", "Priya"), T("t11", "Brisket Brigade", "Mike"), T("t12", "Chuck Wagon", "Ray"),
];
const REC: [number, number][] = [[2, 0], [2, 0], [2, 0], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [0, 2], [0, 2], [0, 2]];
const PF = [271.3, 265.0, 250.8, 244.1, 240.2, 238.7, 231.9, 229.4, 226.0, 219.3, 210.7, 198.2];

const standings = TEAMS.map((t, i) => ({
  team_id: t.id, name: t.name, manager_name: t.manager_name, logo_path: null,
  wins: REC[i][0], losses: REC[i][1], ties: 0, seed: i + 1, points_for: PF[i], points_against: 230,
}));
const me = { ...standings[0], draft_slot: 1, streak: { kind: "W" as const, n: 2 } };
const opp = standings[3];

/** [name, pos, team, slot, espn, kickoff (ET, week 3 2026), projection] */
const MINE: [string, string, string, string, string, string, number][] = [
  ["Josh Allen", "QB", "BUF", "QB", "3918298", "2026-09-27T13:00-04:00", 22.4],
  ["Jonathan Taylor", "RB", "IND", "RB", "4242335", "2026-09-27T13:00-04:00", 18.9],
  ["Bijan Robinson", "RB", "ATL", "RB", "4430807", "2026-09-27T16:25-04:00", 19.6],
  ["Puka Nacua", "WR", "LAR", "WR", "4426515", "2026-09-24T20:15-04:00", 17.1],
  ["Ja'Marr Chase", "WR", "CIN", "WR", "4362628", "2026-09-27T13:00-04:00", 18.2],
  ["Trey McBride", "TE", "ARI", "TE", "4361307", "2026-09-28T20:15-04:00", 12.4],
  ["Jahmyr Gibbs", "RB", "DET", "FLEX", "4429795", "2026-09-27T16:25-04:00", 17.8],
  ["Brandon Aubrey", "K", "DAL", "K", "4249087", "2026-09-27T20:20-04:00", 9.1],
  ["Houston Texans", "DST", "HOU", "DST", "HOU", "2026-09-27T13:00-04:00", 7.5],
];
const THEIRS: [string, string, string, string, string, string, number][] = [
  ["Patrick Mahomes", "QB", "KC", "QB", "3139477", "2026-09-27T16:25-04:00", 21.0],
  ["Christian McCaffrey", "RB", "SF", "RB", "3117251", "2026-09-27T16:25-04:00", 20.3],
  ["De'Von Achane", "RB", "MIA", "RB", "4429160", "2026-09-27T13:00-04:00", 15.2],
  ["Jaxon Smith-Njigba", "WR", "SEA", "WR", "4430878", "2026-09-27T16:25-04:00", 17.9],
  ["Amon-Ra St. Brown", "WR", "DET", "WR", "4374302", "2026-09-27T16:25-04:00", 16.4],
  ["Tucker Kraft", "TE", "GB", "TE", "4572680", "2026-09-27T13:00-04:00", 10.8],
  ["Drake London", "WR", "ATL", "FLEX", "4426502", "2026-09-27T16:25-04:00", 14.7],
  ["Chris Boswell", "K", "PIT", "K", "16339", "2026-09-27T13:00-04:00", 8.6],
  ["Pittsburgh Steelers", "DST", "PIT", "DST", "PIT", "2026-09-27T13:00-04:00", 7.9],
];

/** A lineup at a moment: everything kicked before `now` is live or done. */
function lineup(rows: typeof MINE, now: number, done: number, seed: number): BriefStarter[] {
  return rows.map(([full_name, position, nfl_team, slot, espn_id, kick, projection], i) => {
    const k = new Date(kick).getTime();
    const started = k <= now;
    const final = started && k + 3.2 * 3600000 <= done;
    const pts = started ? Math.round(projection * (0.55 + ((seed * 7 + i * 13) % 10) / 10) * 10) / 10 : 0;
    return {
      player_id: `${seed}-${i}`, full_name, position, nfl_team, slot, espn_id,
      points: final ? pts : started ? Math.round(pts * 0.6 * 10) / 10 : 0,
      projection, kickoff_at: new Date(kick).toISOString(),
      game_status: final ? "post" : started ? "in" : "pre",
      opponent: "—", on_bye: false, final,
    };
  });
}

const sum = (s: BriefStarter[]) => Math.round(s.reduce((a, p) => a + p.points, 0) * 10) / 10;

const base = (now: number, done = now): Briefing => {
  const mine = lineup(MINE, now, done, 1);
  const theirs = lineup(THEIRS, now, done, 2);
  const my_points = sum(mine), opp_points = sum(theirs);
  const pairs: [number, number][] = [[0, 3], [1, 4], [2, 5], [6, 9], [7, 10], [8, 11]];
  const kicked = mine.some((p) => p.game_status !== "pre");
  return {
    league: { id: "L", name: "Main Street Steakhouse", season: 2026, team_count: 12, regular_season_weeks: 14, playoff_teams: 6, playoff_byes: 2, waiver_run_day: "wednesday", is_commissioner: true },
    week: 3,
    me, draft: { id: "D", status: "complete", current_pick: 181, pick_deadline: null, picks_total: 180, on_clock_team_id: null, started_at: null, completed_at: "2026-09-01T02:00:00Z" },
    games: {
      week: 3, first_kick: "2026-09-25T00:15:00Z", last_kick: "2026-09-29T00:15:00Z", total: 16,
      final: 0, in_progress: 0, next_kickoff: "2026-09-25T00:15:00Z", last_final_at: null,
    },
    matchup: {
      id: "m0", week: 3, home: true, my_points, opp_points, my_proj: 143.0, opp_proj: 132.8,
      my_proj_left: mine.filter((p) => p.game_status === "pre").reduce((a, p) => a + (p.projection ?? 0), 0),
      opp_proj_left: theirs.filter((p) => p.game_status === "pre").reduce((a, p) => a + (p.projection ?? 0), 0),
      my_starters: mine, opp_starters: theirs, my_empty_slots: 0, opponent: opp,
    },
    last: {
      week: 2, my_points: 132.4, opp_points: 118.9,
      opponent: { team_id: "t11", name: "Brisket Brigade", manager_name: "Mike", logo_path: null },
      league_high: { team_id: "t9", name: "Sirloin Syndicate", manager_name: "Kai", points: 161.2 },
      my_week_rank: 3, top_scorer: { full_name: "Jonathan Taylor", position: "RB", points: 31.2 },
    },
    history: {
      wins: 4, losses: 7, ties: 0, games: 11, streak: { kind: "L", n: 3 },
      last: { season: 2025, week: 15, round: "semifinal", my: 128.6, theirs: 131.9, won: false },
      playoff_meetings: 2, seasons_on_file: 10,
    },
    standings,
    board: pairs.map(([a, b], i) => ({
      id: `m${i}`, week: 3, home_team_id: TEAMS[a].id, away_team_id: TEAMS[b].id,
      home_points: i === 0 ? my_points : kicked ? 60 + i * 11.3 : 0,
      away_points: i === 0 ? opp_points : kicked ? 55 + i * 9.7 : 0,
      home_proj: i === 0 ? 143.0 : 118 + i * 4.1, away_proj: i === 0 ? 132.8 : 121 - i * 2.6, mine: i === 0,
    })),
    lineup: { starters: 9, slots: 9, empty_slots: 0, on_bye: [], hurt: [{ full_name: "Puka Nacua", severity: "questionable" }], has_roster: true },
    teams: TEAMS,
    now: new Date(now).toISOString(), generated_at: new Date(now).toISOString(),
  };
};

const at = (iso: string) => new Date(iso).getTime();

type Scene = { key: string; label: string; make: () => { b: Briefing; now: number } };

const SCENES: Scene[] = [
  { key: "tue", label: "Tuesday", make: () => { const now = at("2026-09-22T09:30-04:00"); return { b: base(now), now }; } },
  { key: "wed", label: "Wednesday", make: () => { const now = at("2026-09-23T12:00-04:00"); return { b: base(now), now }; } },
  { key: "thu", label: "Thursday", make: () => { const now = at("2026-09-24T18:00-04:00"); return { b: base(now), now }; } },
  { key: "sat", label: "Saturday", make: () => {
    const now = at("2026-09-26T11:00-04:00"); const b = base(now, now);
    b.games.final = 1; b.history = { ...b.history, streak: { kind: "W", n: 2 }, wins: 7, losses: 4 };
    b.lineup = { ...b.lineup!, hurt: [], on_bye: ["Brandon Aubrey"] };
    return { b, now };
  } },
  { key: "sun", label: "Sunday live", make: () => {
    const now = at("2026-09-27T15:10-04:00"); const b = base(now, now);
    b.games.final = 2; b.games.in_progress = 9; b.games.next_kickoff = "2026-09-27T20:25:00Z";
    return { b, now };
  } },
  { key: "settled", label: "Sunday night", make: () => {
    const now = at("2026-09-27T23:40-04:00"); const b = base(now, now);
    b.games.final = 15; b.games.in_progress = 0; b.games.next_kickoff = "2026-09-29T00:15:00Z";
    // Both tables done; McBride's Monday game swapped for one already played.
    b.matchup!.my_starters[5] = { ...b.matchup!.my_starters[5], final: true, game_status: "post", points: 14.2 };
    b.matchup!.my_points = sum(b.matchup!.my_starters); b.matchup!.opp_points = sum(b.matchup!.opp_starters);
    return { b, now };
  } },
  { key: "mon", label: "Monday night", make: () => {
    const now = at("2026-09-28T19:05-04:00"); const b = base(now, now);
    b.games.final = 15; b.games.in_progress = 0; b.games.next_kickoff = "2026-09-29T00:15:00Z";
    b.matchup!.my_points = 118.7; b.matchup!.opp_points = 130.0;
    return { b, now };
  } },
  { key: "draft", label: "Draft night", make: () => {
    const now = at("2026-09-01T20:41-04:00"); const b = base(now);
    b.week = 1; b.last = null; b.matchup = null;
    b.draft = { id: "D", status: "active", current_pick: 27, pick_deadline: new Date(now + 47000).toISOString(), picks_total: 180, on_clock_team_id: "t1", started_at: new Date(now - 3.4e6).toISOString(), completed_at: null };
    return { b, now };
  } },
  { key: "pre", label: "Preseason", make: () => {
    const now = at("2026-09-06T10:00-04:00"); const b = base(now);
    b.week = 1; b.last = null; b.history = { seasons_on_file: 10, games: 11, wins: 4, losses: 7, ties: 0, streak: { kind: "L", n: 3 }, last: b.history.last, playoff_meetings: 2 };
    b.me = { ...me, wins: 0, losses: 0, streak: { kind: null, n: 0 } };
    b.standings = standings.map((s) => ({ ...s, wins: 0, losses: 0, points_for: 0 }));
    b.lineup = { ...b.lineup!, starters: 0, has_roster: false, hurt: [] };
    b.games = { ...b.games, week: 1, first_kick: "2026-09-10T00:20:00Z", last_kick: "2026-09-15T00:15:00Z", next_kickoff: "2026-09-10T00:20:00Z" };
    return { b, now };
  } },
];

export default function TonightPreview() {
  const [key, setKey] = useState("thu");
  const scene = SCENES.find((s) => s.key === key) ?? SCENES[0];
  const { b, now } = scene.make();
  const phase = phaseOf(b, now);

  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
        display: "flex", gap: "var(--s3)", alignItems: "center", flexWrap: "wrap",
      }}>
        <span><strong>Fixture.</strong> Invented league; the card is real. Phase: <code>{phase}</code>.</span>
        <div className="scroll" style={{ overflowX: "auto", marginLeft: "auto" }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {SCENES.map((s) => (
              <button key={s.key} className="segmented__opt" data-on={s.key === key} onClick={() => setKey(s.key)}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>
      <main className="page tonight" data-width="narrow">
        <TonightsTable b={b} now={now} onShare={() => alert("Share sheet")} />
        <Carousel b={b} live={phase === "live"} />
        <p className="eyebrow tonight__foot">Main Street Steakhouse · Est. 2016 · Members Only</p>
      </main>
    </>
  );
}
