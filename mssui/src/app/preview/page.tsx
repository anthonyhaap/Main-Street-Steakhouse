"use client";

/**
 * Fixture harness. Renders the dashboard from static data so the layout can be
 * inspected without a session or a database. Not linked from anywhere.
 */

import { useState } from "react";
import { LeagueDashboard, type Hub } from "@/components/LeagueDashboard";
import { TopBar } from "@/components/Shell";
import type { Pulse } from "@/lib/types";

const NAMES = [
  "Gridiron Butchers", "Prime Cut", "Dry Aged Dynasty", "The Porterhouse",
  "Bone-In Bandits", "Wagyu Warriors", "Tomahawk Chop", "Filet Force",
  "Sirloin Syndicate", "Ribeye Renegades", "Brisket Brigade", "Chuck Wagon",
];

const teams = NAMES.map((name, i) => ({
  id: `t${i + 1}`, league_id: "L", name, owner_id: i < 9 ? `u${i}` : null,
  owner_email: i < 11 ? `m${i}@example.com` : null, draft_slot: i + 1,
}));

const pulse: Pulse = {
  league: {
    id: "L", name: "Main Street Steakhouse", season: 2026, team_count: 12,
    roster_slots: ["QB","RB","RB","WR","WR","TE","FLEX","K","DST","BN","BN","BN","BN","BN","BN"],
    commissioner_id: "u0", is_commissioner: true,
  },
  draft: {
    id: "D", status: "active", rounds: 15, pick_seconds: 90, current_pick: 27,
    pick_deadline: new Date(Date.now() + 47000).toISOString(),
    started_at: new Date(Date.now() - 3.4e6).toISOString(), completed_at: null,
    picks_made: 26, picks_total: 180, order_set: true, teams_with_queue: 9,
  },
  managers: teams.map((t, i) => ({
    team_id: t.id, name: t.name, draft_slot: t.draft_slot, email: t.owner_email,
    joined: i < 9, invited: i < 11,
    display_name: i < 9 ? ["Anthony","Marcus","Dev","Ray","Tom","Nate","Jules","Sam","Kai"][i] : null,
    queued: i < 9 ? 8 + i : 0, roster: 0, picks: i < 2 ? 3 : 2,
  })),
  checks: [
    { key: "commish", label: "Commissioner claimed", ok: true, detail: "Locked to one account.", fix: "/admin" },
    { key: "invited", label: "All managers invited", ok: false, detail: "11 of 12 seats have an email on file.", fix: "/admin" },
    { key: "joined", label: "All managers signed in", ok: false, detail: "9 of 12 have created a login.", fix: "/admin" },
    { key: "order", label: "Draft order set", ok: true, detail: "Slots 1-12 assigned, no duplicates.", fix: "/admin" },
    { key: "pool", label: "Player pool loaded", ok: true, detail: "1304 skill players in the pool.", fix: "/players" },
    { key: "adp", label: "ADP loaded", ok: true, detail: "282 players ranked for 2026.", fix: "/admin" },
    { key: "byes", label: "Bye weeks populated", ok: true, detail: "1110 of 1304 players have a bye on file.", fix: "/admin" },
    { key: "schedule", label: "NFL schedule loaded", ok: true, detail: "272 regular-season games for 2026.", fix: "/admin" },
    { key: "scoring", label: "Scoring rules published", ok: true, detail: "1 rule set(s) on record.", fix: "/admin" },
    { key: "matchups", label: "Season schedule generated", ok: true, detail: "84 matchups scheduled.", fix: "/matchups" },
    { key: "automation", label: "Background jobs healthy", ok: true, detail: "4 scheduled jobs running on time.", fix: "/admin" },
    { key: "queues", label: "Managers have a draft queue", ok: false, detail: "9 of 12 teams have queued a player. Autopick follows the queue.", fix: "/draft" },
  ],
  readiness: { passed: 9, total: 12, pct: 75 },
  data: {
    players: 1304, adp: 282, byes: 1110, games: 272,
    last_stats_at: new Date(Date.now() - 5.4e6).toISOString(),
    last_ingest_at: new Date(Date.now() - 1.9e5).toISOString(),
    jobs: [
      { name: "draft-tick", schedule: "5 seconds", active: true, last_run: new Date(Date.now() - 4000).toISOString(), last_status: "succeeded", healthy: true },
      { name: "live-stats", schedule: "*/2 * * * *", active: true, last_run: new Date(Date.now() - 61000).toISOString(), last_status: "succeeded", healthy: true },
      { name: "resolve-matchup-challenges", schedule: "*/5 * * * *", active: true, last_run: new Date(Date.now() - 121000).toISOString(), last_status: "succeeded", healthy: true },
      { name: "stats-settle", schedule: "17 9 * * *", active: true, last_run: new Date(Date.now() - 6.4e7).toISOString(), last_status: "succeeded", healthy: true },
    ],
  },
  season: {
    week: 1,
    next_kickoff: new Date(Date.now() + 1.2e9).toISOString(),
    calendar: Array.from({ length: 18 }, (_, i) => ({
      week: i + 1, games: i === 13 ? 13 : 16,
      first_kick: new Date(Date.UTC(2026, 8, 10 + i * 7)).toISOString(),
      last_kick: new Date(Date.UTC(2026, 8, 14 + i * 7)).toISOString(),
      final: 0,
    })),
  },
  clubhouse: { open_challenges: 3, messages_7d: 47 },
  activity: [
    { id: "1", type: "pick", headline: "Prime Cut drafted Bijan Robinson", detail: "Round 3, pick 2", created_at: new Date(Date.now() - 6e4).toISOString(), actor: "Marcus" },
    { id: "2", type: "challenge", headline: "Dry Aged Dynasty challenged The Porterhouse", detail: "Week 1 head to head · loser buys the ribeye", created_at: new Date(Date.now() - 9e5).toISOString(), actor: "Dev" },
    { id: "3", type: "join", headline: "Kai claimed Sirloin Syndicate", detail: null, created_at: new Date(Date.now() - 3.6e6).toISOString(), actor: "Kai" },
    { id: "4", type: "draft", headline: "Draft opened", detail: "15 rounds · 90 seconds per pick", created_at: new Date(Date.now() - 3.5e6).toISOString(), actor: "Anthony" },
  ],
  generated_at: new Date().toISOString(),
};

const POS = ["RB", "WR", "QB", "TE", "WR", "RB", "WR", "TE", "K", "DST"];
const PLAYERS = [
  "Ja'Marr Chase", "Bijan Robinson", "Josh Allen", "Brock Bowers", "Malik Nabers",
  "Saquon Barkley", "CeeDee Lamb", "Trey McBride", "Jake Bates", "Ravens D/ST",
];

const hub: Hub = {
  pulse,
  teams,
  recent: PLAYERS.map((player_name, i) => ({
    draft_id: "D", pick_number: 26 - i, round: Math.floor((25 - i) / 12) + 1,
    is_autopick: i === 3, made_at: new Date(Date.now() - i * 9e4).toISOString(),
    team_id: teams[i % 12].id, team_name: teams[i % 12].name,
    draft_slot: teams[i % 12].draft_slot, player_id: `p${i}`,
    player_name, position: POS[i], nfl_team: ["CIN","ATL","BUF","LV","NYG","PHI","DAL","ARI","DET","BAL"][i],
  })),
  standings: teams.map((t) => ({
    league_id: "L", team_id: t.id, name: t.name,
    wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0,
  })),
  matchups: Array.from({ length: 6 }, (_, i) => ({
    id: `m${i}`, league_id: "L", week: 1,
    home_team_id: teams[i * 2].id, away_team_id: teams[i * 2 + 1].id,
    home_points: 0, away_points: 0,
  })),
};

export default function Preview() {
  const [now] = useState(() => Date.now());
  return (
    <>
      <TopBar status="live" />
      <LeagueDashboard data={hub} myTeamId="t1" now={now} msLeft={47000} />
    </>
  );
}
