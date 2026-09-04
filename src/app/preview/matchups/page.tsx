"use client";

/**
 * Fixture harness for the Sunday board. Not linked from anywhere.
 *
 * The live page needs a session, a completed draft and a week with rosters in
 * it, which is why this screen went unlooked-at for so long. It now needs a
 * *live* week on top of that — a scoreboard whose whole point is what is
 * happening right now can only be judged mid-afternoon. So the afternoon is
 * invented here, and the switch at the top runs it forward: the preseason with
 * no rosters at all, nothing kicked, the one o'clock games on, the late
 * window, and Monday with one man left.
 *
 * The players and their ESPN ids are real. The teams, scores, projections and
 * lineups are invented, and the managers are not real people.
 */

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { TopBar } from "@/components/Shell";
import { Scoreboard } from "@/components/Scoreboard";
import { TalkThread } from "@/components/matchup/Talk";
import { freshness, slateLine, talkTeaser, type ScoreCard, type ScoreSide, type ScoreStarter, type Scoreboard as Board, type Talk, type ThreadMessage } from "@/lib/scoreboard";

/** Sunday of week 11, 1:07pm Eastern, as a fixed clock. */
const NOW = Date.parse("2026-11-22T18:07:00Z");
const H = 3600_000;

const LEAGUE = "11111111-1111-1111-1111-111111111111";
const MY_TEAM = "t3";

/** name, position, club, ESPN id, kickoff window — all but the window real. */
const POOL: [string, string, string, string, number][] = [
  ["Patrick Mahomes", "QB", "KC", "3139477", 0],
  ["Josh Allen", "QB", "BUF", "3918298", 3],
  ["Jahmyr Gibbs", "RB", "DET", "4429795", 0],
  ["Bijan Robinson", "RB", "ATL", "4430807", 0],
  ["Christian McCaffrey", "RB", "SF", "3117251", 3],
  ["Jonathan Taylor", "RB", "IND", "4242335", 0],
  ["De'Von Achane", "RB", "MIA", "4429160", 3],
  ["Puka Nacua", "WR", "LAR", "4426515", 3],
  ["Ja'Marr Chase", "WR", "CIN", "4362628", 0],
  ["Jaxon Smith-Njigba", "WR", "SEA", "4430878", 3],
  ["Amon-Ra St. Brown", "WR", "DET", "4374302", 0],
  ["Drake London", "WR", "ATL", "4426502", 0],
  ["Trey McBride", "TE", "ARI", "4361307", 3],
  ["Tucker Kraft", "TE", "GB", "4572680", 0],
  ["Chris Boswell", "K", "PIT", "16339", 0],
  ["Brandon Aubrey", "K", "DAL", "4249087", 3],
];

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST"];
const forSlot = (slot: string) => POOL.filter(([, pos]) => pos === (slot === "FLEX" ? "RB" : slot));

type Stage = "undrafted" | "pre" | "early" | "late" | "monday";

const STAGES: { key: Stage; label: string; note: string }[] = [
  { key: "undrafted", label: "Before the draft", note: "No rosters, so no projections and no odds — the card says what it knows and nothing more." },
  { key: "pre", label: "Nothing kicked", note: "Sunday morning. Projections are the only numbers there are, so they are the ones on the card." },
  { key: "early", label: "One o'clock games on", note: "Six games in progress. Scores tick, the pip pulses, the odds move with the projected remainder." },
  { key: "late", label: "Late window", note: "The one o'clock games are final and the four o'clocks are on. This is the hour the page exists for." },
  { key: "monday", label: "Monday night", note: "One man left against an empty bench — the line people screenshot." },
];

/** Which windows have kicked, and which are on, at each stage. */
const CLOCK: Record<Stage, { done: number[]; on: number[] }> = {
  undrafted: { done: [], on: [] },
  pre: { done: [], on: [] },
  early: { done: [], on: [0] },
  late: { done: [0], on: [3] },
  monday: { done: [0, 3], on: [] },
};

function starter(
  slot: string, i: number, offset: number, stage: Stage, soloWindow: boolean,
  used: Set<string>,
): ScoreStarter {
  // FLEX and RB draw from the same players, and a lineup starting one man in
  // two slots is a fixture nobody believes.
  const eligible = (slot === "DST" ? [] : forSlot(slot)).filter(([n]) => !used.has(n));
  const pool = eligible.length ? eligible : (slot === "DST" ? [] : forSlot(slot));
  const pick = pool.length
    ? pool[(offset + i) % pool.length]
    : (["Houston Texans", "DST", "HOU", "HOU", 0] as [string, string, string, string, number]);
  used.add(pick[0]);
  const [full_name, position, nfl_team, espn_id, win] = pick;
  // Monday's last man: one starter is pushed into a window nobody else is in.
  const window = soloWindow ? 26 : win;
  const { done, on } = CLOCK[stage];
  const status = done.includes(window) ? "post" : on.includes(window) ? "in" : "pre";

  // Deterministic, so the fixture never flickers between renders. The swing
  // is centred on 1 rather than on a half, so an invented afternoon lands
  // around its projections the way a real one does.
  const proj = Math.round((7 + ((offset * 5 + i * 11) % 15)) * 10) / 10;
  const swing = 0.55 + ((offset * 7 + i * 13) % 10) / 11;
  const points = status === "pre" ? 0
    : status === "in" ? Math.round(proj * 0.55 * swing * 10) / 10
    : Math.round(proj * swing * 10) / 10;

  return {
    player_id: `p-${offset}-${i}`, full_name, position, nfl_team, slot, espn_id,
    points, projection: proj,
    // Sunday morning's kickoffs are all ahead of the clock; every later stage
    // has the one o'clock window already behind it.
    kickoff_at: new Date(NOW + (window + (stage === "pre" ? 3 : -1)) * H).toISOString(),
    game_status: status,
    game_detail: status === "in" ? "Q2 8:41" : status === "post" ? "Final" : null,
    opponent: "NYJ", at_home: i % 2 === 0, severity: null,
    on_bye: false,
    final: status === "post",
  };
}

function side(
  team_id: string, name: string, manager: string, offset: number, stage: Stage,
  opts: { solo?: boolean; wins?: number } = {},
): ScoreSide {
  const used = new Set<string>();
  // Before the draft a team has no players at all — the one state the board
  // spends its whole preseason in.
  const starters = stage === "undrafted" ? [] : SLOTS.map((slot, i) =>
    starter(slot, i, offset, stage, !!opts.solo && i === SLOTS.length - 3, used));
  const sum = (f: (p: ScoreStarter) => number) =>
    Math.round(starters.reduce((s, p) => s + f(p), 0) * 10) / 10;

  return {
    team_id, name, manager_name: manager, logo_path: null,
    wins: stage === "undrafted" ? 0 : opts.wins ?? 6,
    losses: stage === "undrafted" ? 0 : 10 - (opts.wins ?? 6),
    ties: 0,
    points: sum((p) => p.points),
    proj: sum((p) => Number(p.projection ?? 0)),
    proj_left: sum((p) => (p.game_status === "pre" ? Number(p.projection ?? 0) : 0)),
    yet_to_play: starters.filter((p) => !p.final).length,
    in_action: starters.filter((p) => p.game_status === "in").length,
    empty_slots: stage === "undrafted" ? SLOTS.length : 0,
    top: (() => {
      const best = [...starters].sort((a, b) => b.points - a.points)[0];
      return best ? {
        full_name: best.full_name, position: best.position, nfl_team: best.nfl_team,
        points: best.points, game_status: best.game_status,
      } : null;
    })(),
    starters,
    mine: team_id === MY_TEAM,
  };
}

/**
 * An argument, invented. Read-only here: `TalkThread` without an `onSend` is
 * the thread a signed-out reader gets, which is also the one a fixture can
 * render — the post itself needs a session and a database.
 */
const THREAD: ThreadMessage[] = [
  ["Ray", "The Porterhouse", "home", "Starting Robinson over Gibbs is a choice.", 52],
  ["Dev", "Dry Aged Dynasty", "away", "It's called conviction. Look it up.", 41],
  ["Marcus", "Prime Cut", null, "It's called being three points from last.", 12],
  ["Ray", "The Porterhouse", "home", "Kicker's on bye, Dev. Check your K.", 3],
].map(([manager, team, side, body, minsAgo], i) => ({
  id: `msg-${i}`,
  body: body as string,
  created_at: new Date(NOW - (minsAgo as number) * 60_000).toISOString(),
  edited_at: null,
  author_id: `u-${i}`,
  kind: "manager" as const,
  mine: manager === "Ray",
  author_team_id: `t-${i}`,
  author_name: team as string,
  author_manager: manager as string,
  author_logo: null,
  side: side as "home" | "away" | null,
}));

const TALK: Talk = {
  count: THREAD.length,
  last: {
    body: THREAD[THREAD.length - 1].body,
    created_at: THREAD[THREAD.length - 1].created_at,
    author: "Ray",
    mine: true,
  },
};

const QUIET: Talk = { count: 0, last: null };

function board(stage: Stage): Board {
  // A league that has not drafted is in week one, whatever the rest of the
  // fixture's Sunday says.
  const wk = stage === "undrafted" ? 1 : 11;
  const cards: ScoreCard[] = [
    {
      id: "m1", week: wk, mine: true, talk: TALK,
      away: side("t4", "Dry Aged Dynasty", "Dev", 2, stage, { wins: 7 }),
      home: side(MY_TEAM, "The Porterhouse", "Ray", 5, stage, { solo: stage === "monday", wins: 6 }),
    },
    {
      id: "m2", week: wk, mine: false, talk: QUIET,
      away: side("t1", "Prime Cut", "Marcus", 1, stage, { wins: 9 }),
      home: side("t2", "Gridiron Butchers", "Anthony", 8, stage, { wins: 4 }),
    },
    {
      id: "m3", week: wk, mine: false, talk: QUIET,
      away: side("t5", "Bone-In Bandits", "Tom", 3, stage, { wins: 5 }),
      home: side("t6", "Wagyu Warriors", "Nate", 11, stage, { wins: 5 }),
    },
  ];

  const done = CLOCK[stage].done.length, on = CLOCK[stage].on.length;
  return {
    league: {
      id: LEAGUE, name: "Main Street Steakhouse", season: 2026,
      team_count: 12, regular_season_weeks: 14, roster_slots: [...SLOTS, "BN", "BN", "BN"],
    },
    week: wk,
    my_team_id: MY_TEAM,
    games: {
      week: wk,
      first_kick: new Date(NOW - H).toISOString(),
      last_kick: new Date(NOW + 26 * H).toISOString(),
      total: 14,
      final: done * 6,
      in_progress: on * 6,
      next_kickoff: stage === "monday" ? new Date(NOW + 2 * H).toISOString() : new Date(NOW + 3 * H).toISOString(),
    },
    matchups: cards,
    // Nothing has been scored before the first kick, so nothing has a
    // timestamp — the page has to read right in that state too.
    stats_updated_at: done + on === 0 ? null : new Date(NOW - 90_000).toISOString(),
    projections_updated_at: new Date(NOW - 5 * H).toISOString(),
    now: new Date(NOW).toISOString(),
    generated_at: new Date(NOW).toISOString(),
  };
}

/** The closed line and, opened, the thread — with no way to post from here. */
function FixtureTalk({ card }: { card: ScoreCard }) {
  const [open, setOpen] = useState(card.talk.count > 0);
  const messages = card.talk.count > 0 ? THREAD : [];
  return (
    <div className="sb__talk">
      <button className="sb__talk-open" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <MessageCircle size={14} />
        <span className="sb__talk-label">Table talk</span>
        {card.talk.count > 0 && <span className="sb__talk-n">{card.talk.count}</span>}
        <span className="sb__talk-teaser">{talkTeaser(card.talk)}</span>
      </button>
      {open && (
        <TalkThread
          messages={messages}
          now={NOW}
          emptyLine="Nobody has said anything about this one yet."
        />
      )}
    </div>
  );
}

export default function MatchupsPreviewPage() {
  const [stage, setStage] = useState<Stage>("late");
  const b = board(stage);
  const note = STAGES.find((s) => s.key === stage)!.note;

  return (
    <>
      <TopBar status="live" />
      <div style={{
        padding: "10px clamp(16px, 3vw, 32px)", background: "var(--gold-haze)",
        borderBottom: "1px solid var(--gold-dim)", color: "#7d5a11", fontSize: "var(--t-small)",
      }}>
        <strong>Fixture.</strong> Three games on a fixed Sunday clock. Real players and
        real ESPN ids; the teams, scores, projections and lineups are invented.
      </div>

      <main className="page sb-board" data-width="mid">
        <div className="scroll" style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
          <div className="segmented" style={{ width: "max-content" }}>
            {STAGES.map((s) => (
              <button key={s.key} className="segmented__opt" data-on={s.key === stage} onClick={() => setStage(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p className="prose" style={{ margin: 0, fontSize: "var(--t-small)" }}>{note}</p>

        <div className="sb-slate">
          <p>{slateLine(b.games, NOW)}</p>
          <span className="sb-slate__fresh">
            Scores <b>{freshness(b.stats_updated_at, NOW)}</b>
            {` · projections ${freshness(b.projections_updated_at, NOW)}`}
          </span>
        </div>

        <Scoreboard
          board={b}
          now={NOW}
          talk={(c) => <FixtureTalk card={c} />}
        />
      </main>
    </>
  );
}
