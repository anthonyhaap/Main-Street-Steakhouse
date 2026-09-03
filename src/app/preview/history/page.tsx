"use client";

/**
 * Fixture harness for the history wall. Not linked from anywhere.
 *
 * Ten invented seasons for twelve invented managers, generated from a seed
 * and folded into the same shape `ff_history` returns, so the wall can be
 * looked at — and its heat map judged — before a single old season has been
 * imported. Nothing here is a real person or a real result.
 */

import { useMemo } from "react";
import { TopBar } from "@/components/Shell";
import { HistoryWall } from "@/components/history/HistoryWall";
import { mulberry32 } from "@/lib/playoffs";
import type { History, HistoryCell, HistoryManager, HistorySeason } from "@/lib/history";

const MANAGERS = ["Anthony", "Marcus", "Dev", "Dave", "Tom", "Nate", "Jules", "Sam", "Kai", "Priya", "Mike", "Ray"];
const TEAMS = [
  "Gridiron Butchers", "Prime Cut", "Dry Aged Dynasty", "The Porterhouse", "Bone-In Bandits", "Wagyu Warriors",
  "Tomahawk Chop", "Filet Force", "Sirloin Syndicate", "Ribeye Renegades", "Brisket Brigade", "Chuck Wagon",
];
/** A manager's typical week; the spread is what makes streaks and blowouts. */
const STRENGTH = [126, 118, 121, 124, 110, 115, 119, 108, 122, 113, 127, 104];

type Game = { season: number; week: number; round: string; home: string; away: string; hp: number; ap: number };

function generate(): Game[] {
  const rand = mulberry32(0x2016);
  const games: Game[] = [];
  const score = (i: number) => Math.round((STRENGTH[i] + (rand() - 0.5) * 2 * 34) * 10) / 10;

  for (let season = 2016; season <= 2025; season++) {
    const wins = new Array(12).fill(0);
    const pf = new Array(12).fill(0);
    for (let week = 1; week <= 14; week++) {
      // Rotate pairings so everyone meets everyone; a home/away split per week.
      const order = [...Array(12).keys()].map((i) => (i === 0 ? 0 : ((i + week - 1) % 11) + 1));
      for (let p = 0; p < 6; p++) {
        const a = order[p], b = order[11 - p];
        const hp = score(a), ap = score(b);
        games.push({ season, week, round: "regular", home: MANAGERS[a], away: MANAGERS[b], hp, ap });
        pf[a] += hp; pf[b] += ap;
        if (hp > ap) wins[a]++; else if (ap > hp) wins[b]++;
      }
    }
    const seeds = [...Array(12).keys()].sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]).slice(0, 6);
    // Byes for the top two; 3 v 6 and 4 v 5 in week 15.
    const q1 = [seeds[2], seeds[5]], q2 = [seeds[3], seeds[4]];
    const play = (pair: number[], week: number, round: string) => {
      const [a, b] = pair; const hp = score(a), ap = score(b);
      games.push({ season, week, round, home: MANAGERS[a], away: MANAGERS[b], hp, ap });
      return hp >= ap ? a : b;
    };
    const w1 = play(q1, 15, "quarterfinal"), w2 = play(q2, 15, "quarterfinal");
    const s1 = play([seeds[0], w2], 16, "semifinal"), s2 = play([seeds[1], w1], 16, "semifinal");
    play([s1, s2], 17, "final");
  }
  return games;
}

/** Fold the games into what ff_history returns. Mirrors the SQL, in miniature. */
function fold(games: Game[]): History {
  const side = games.flatMap((g) => [
    { ...g, manager: g.home, opponent: g.away, pf: g.hp, pa: g.ap },
    { ...g, manager: g.away, opponent: g.home, pf: g.ap, pa: g.hp },
  ]);
  const finals = games.filter((g) => g.round === "final");
  const winner = (g: Game) => (g.hp > g.ap ? g.home : g.away);
  const loser = (g: Game) => (g.hp > g.ap ? g.away : g.home);

  const managers: HistoryManager[] = MANAGERS.map((m, i) => {
    const mine = side.filter((s) => s.manager === m);
    const wins = mine.filter((s) => s.pf > s.pa).length;
    const losses = mine.filter((s) => s.pf < s.pa).length;
    const won = finals.filter((f) => winner(f) === m);
    const best = mine.reduce((a, b) => (b.pf > a.pf ? b : a), mine[0]);
    return {
      manager: m, seasons: 10, wins, losses, ties: mine.length - wins - losses,
      points_for: Math.round(mine.reduce((a, s) => a + s.pf, 0) * 10) / 10,
      points_against: Math.round(mine.reduce((a, s) => a + s.pa, 0) * 10) / 10,
      avg: Math.round((mine.reduce((a, s) => a + s.pf, 0) / mine.length) * 10) / 10,
      titles: won.length, finals: finals.filter((f) => f.home === m || f.away === m).length,
      playoff_games: mine.filter((s) => s.round !== "regular").length,
      best_week: { season: best.season, week: best.week, points: best.pf },
      title_years: won.map((f) => f.season), current_team: TEAMS[i], team_id: `t${i + 1}`, logo_path: null,
    };
  }).sort((a, b) => b.titles - a.titles || b.wins - a.wins);

  const grid: HistoryCell[] = [];
  for (const a of MANAGERS) for (const b of MANAGERS) {
    if (a === b) continue;
    const g = side.filter((s) => s.manager === a && s.opponent === b);
    grid.push({ manager: a, opponent: b, wins: g.filter((s) => s.pf > s.pa).length, losses: g.filter((s) => s.pf < s.pa).length, ties: 0 });
  }

  const streaks = MANAGERS.flatMap((m) => {
    const mine = side.filter((s) => s.manager === m).sort((a, b) => a.season - b.season || a.week - b.week);
    const runs: { n: number; from: { season: number; week: number }; to: { season: number; week: number } }[] = [];
    let run: typeof runs[number] | null = null;
    for (const s of mine) {
      if (s.pf > s.pa) {
        if (!run) run = { n: 0, from: { season: s.season, week: s.week }, to: { season: s.season, week: s.week } };
        run.n++; run.to = { season: s.season, week: s.week };
      } else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    return runs.map((r) => ({ manager: m, ...r }));
  }).sort((a, b) => b.n - a.n).slice(0, 5);

  const blowouts = [...games].sort((a, b) => Math.abs(b.hp - b.ap) - Math.abs(a.hp - a.ap)).slice(0, 5)
    .map((g) => ({ season: g.season, week: g.week, round: g.round, winner: winner(g), loser: loser(g), w: Math.max(g.hp, g.ap), l: Math.min(g.hp, g.ap), margin: Math.round(Math.abs(g.hp - g.ap) * 10) / 10 }));
  const highs = [...side].sort((a, b) => b.pf - a.pf).slice(0, 5)
    .map((s) => ({ season: s.season, week: s.week, manager: s.manager, points: s.pf, opponent: s.opponent }));

  const rivalries = [] as History["rivalries"];
  for (let i = 0; i < MANAGERS.length; i++) for (let j = i + 1; j < MANAGERS.length; j++) {
    const a = MANAGERS[i], b = MANAGERS[j];
    const g = games.filter((x) => (x.home === a && x.away === b) || (x.home === b && x.away === a));
    const aw = g.filter((x) => winner(x) === a).length, bw = g.length - aw;
    const po = g.filter((x) => x.round !== "regular").length;
    const margin = g.reduce((s, x) => s + Math.abs(x.hp - x.ap), 0) / g.length;
    rivalries.push({ a, b, games: g.length, a_wins: aw, b_wins: bw, playoff: po, avg_margin: Math.round(margin * 10) / 10, score: g.length + po * 2 - Math.abs(aw - bw) * 1.5 - margin / 10 });
  }
  rivalries.sort((x, y) => y.score - x.score);

  const seasons: HistorySeason[] = [...new Set(games.map((g) => g.season))].sort((a, b) => b - a).map((season) => {
    const f = finals.find((x) => x.season === season)!;
    return { season, games: games.filter((g) => g.season === season).length, champion: winner(f), runner_up: loser(f), final_score: { w: Math.max(f.hp, f.ap), l: Math.min(f.hp, f.ap) }, in_progress: false, best_record: null };
  });
  seasons.unshift({ season: 2026, games: 12, champion: null, runner_up: null, final_score: null, in_progress: true, best_record: { manager: "Anthony", wins: 2, losses: 0 } });

  return {
    league: { id: "L", name: "Main Street Steakhouse", season: 2026, est: 2016 },
    games: games.length, seasons, managers, grid, streaks, blowouts, highs, rivalries: rivalries.slice(0, 4),
    generated_at: new Date().toISOString(),
  };
}

export default function HistoryPreview() {
  const history = useMemo(() => fold(generate()), []);
  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> Ten invented seasons for twelve invented managers, generated from a seed.
        Nobody here is a real person; every plaque, streak and beating is made up.
      </div>
      <HistoryWall history={history} myManager="Anthony" importable />
    </>
  );
}
