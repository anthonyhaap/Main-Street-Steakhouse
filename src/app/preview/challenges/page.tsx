"use client";

/**
 * Fixture harness for the challenge cards. Reads no database.
 *
 * The real screen needs a session, two managers with Venmo handles and a week
 * that has been decided, so this is every state of a bet at once, seen from
 * one seat: a slip you owe, a slip you are owed, a payment waiting on your
 * word, a shot waiting on your answer, a bet settled, a tie, and — with the
 * switch — the commissioner's view of a bet that needs a ruling. The last
 * three are against the spread: a line offered before kickoff, a game on with
 * somebody covering, and a final that went your way.
 */

import { useState } from "react";
import { TopBar } from "@/components/Shell";
import { ChallengeCard, useTargetChallenge, type ChallengeActions } from "@/components/challenges/ChallengeCard";
import type { SpreadGame } from "@/lib/spread";
import type { Challenge, LeagueProfile } from "@/lib/types";

const ME = "u-me", DAVE = "u-dave", MIKE = "u-mike", SAM = "u-sam", PRIYA = "u-priya";
const NAMES: Record<string, string> = { [ME]: "You", [DAVE]: "Dave", [MIKE]: "Mike", [SAM]: "Sam", [PRIYA]: "Priya" };
const WEEKS: Record<string, number> = { m5: 5, m6: 6, m4: 4, m7: 7, m3: 3 };

const PROFILES: LeagueProfile[] = [
  { id: ME, display_name: "You", settlement_provider: "venmo", settlement_handle: "me-pays", settlement_opt_in_at: "2026-09-01T00:00:00Z" },
  { id: DAVE, display_name: "Dave", settlement_provider: "venmo", settlement_handle: "dave-pays", settlement_opt_in_at: "2026-09-01T00:00:00Z" },
  { id: MIKE, display_name: "Mike", settlement_provider: "venmo", settlement_handle: "mike-pays", settlement_opt_in_at: "2026-09-01T00:00:00Z" },
  { id: SAM, display_name: "Sam", settlement_provider: "venmo", settlement_handle: "sam-pays", settlement_opt_in_at: "2026-09-01T00:00:00Z" },
];

const base = (over: Partial<Challenge> & Pick<Challenge, "id" | "challenger_id" | "opponent_id" | "title" | "status">): Challenge => ({
  league_id: "L", proposition_type: "weekly_matchup_winner", terms: "Winner has the higher final score.",
  stake_label: "External settlement", terms_hash: "x", accepted_at: null, locked_at: null, resolved_at: null,
  winner_id: null, stake_amount_cents: null, matchup_id: null, settlement_due_at: null, payment_marked_at: null,
  payment_marked_by: null, payment_reference: null, receipt_confirmed_at: null, receipt_confirmed_by: null,
  disputed_at: null, dispute_reason: null, resolution_evidence: null, created_at: "2026-10-01T00:00:00Z",
  nfl_game_id: null, spread_team: null, spread_line: null,
  ...over,
});

const IN_A_WEEK = new Date(Date.now() + 6 * 864e5).toISOString();
const LAST_WEEK = new Date(Date.now() - 2 * 864e5).toISOString();

// A fixed kickoff, not one counted from now: the card prints its time, and
// this page is prerendered, so a moving clock would not hydrate.
const SUNDAY = "2026-10-18T17:00:00Z";

const GAMES: SpreadGame[] = [
  { id: "g1", week: 7, home_team: "KC", away_team: "BUF", kickoff_at: SUNDAY, status: "pre",
    status_detail: null, home_score: null, away_score: null, home_spread: -3 },
  { id: "g2", week: 7, home_team: "MIA", away_team: "BUF", kickoff_at: LAST_WEEK, status: "in",
    status_detail: "Q3 8:14", home_score: 17, away_score: 13, home_spread: -2.5 },
  { id: "g3", week: 6, home_team: "DAL", away_team: "PHI", kickoff_at: LAST_WEEK, status: "post",
    status_detail: "Final", home_score: 24, away_score: 20, home_spread: -3.5 },
];

const spread = (game: string, team: string, line: number) => ({
  proposition_type: "nfl_spread" as const, nfl_game_id: game, spread_team: team, spread_line: line,
});

const CHALLENGES: Challenge[] = [
  base({ id: "c1", challenger_id: DAVE, opponent_id: ME, title: "Higher Week 5 score", status: "resolved",
    winner_id: DAVE, stake_amount_cents: 2000, matchup_id: "m5", settlement_due_at: IN_A_WEEK, resolved_at: "2026-10-07T10:00:00Z" }),
  base({ id: "c2", challenger_id: ME, opponent_id: MIKE, title: "Higher Week 6 score", status: "resolved",
    winner_id: ME, stake_amount_cents: 1000, matchup_id: "m6", settlement_due_at: IN_A_WEEK }),
  base({ id: "c3", challenger_id: SAM, opponent_id: ME, title: "Higher Week 4 score", status: "payment_pending",
    winner_id: ME, stake_amount_cents: 1250, matchup_id: "m4", settlement_due_at: IN_A_WEEK, payment_reference: "Venmo: Week 4, ouch" }),
  base({ id: "c4", challenger_id: SAM, opponent_id: ME, title: "Higher Week 7 score", status: "proposed",
    stake_amount_cents: 500, matchup_id: "m7" }),
  base({ id: "c5", challenger_id: ME, opponent_id: PRIYA, title: "Most points in Week 3", status: "settled",
    winner_id: PRIYA, stake_label: "Bragging rights", matchup_id: "m3" }),
  base({ id: "c6", challenger_id: MIKE, opponent_id: DAVE, title: "Higher Week 5 score", status: "voided",
    stake_amount_cents: 2000, matchup_id: "m5" }),
  base({ id: "c7", challenger_id: DAVE, opponent_id: MIKE, title: "Who drafts the better kicker", status: "accepted",
    proposition_type: "custom", terms: "Commissioner rules at the end of the season.", stake_label: "Bragging rights" }),
  base({ id: "c8", challenger_id: MIKE, opponent_id: ME, title: "Higher Week 5 score", status: "resolved",
    winner_id: MIKE, stake_amount_cents: 1500, matchup_id: "m5", settlement_due_at: LAST_WEEK }),
  base({ id: "c9", challenger_id: SAM, opponent_id: ME, title: "KC -3 vs BUF", status: "proposed", stake_amount_cents: 2000,
    terms: "Sam takes KC -3. You take BUF +3. Week 7, decided by the final score, overtime included.", ...spread("g1", "KC", -3) }),
  base({ id: "c10", challenger_id: ME, opponent_id: DAVE, title: "BUF +2.5 at MIA", status: "accepted", stake_label: "Bragging rights",
    terms: "You take BUF +2.5. Dave takes MIA -2.5. Week 7, decided by the final score, overtime included.", ...spread("g2", "BUF", 2.5) }),
  base({ id: "c11", challenger_id: ME, opponent_id: MIKE, title: "DAL -3.5 vs PHI", status: "resolved", winner_id: ME,
    stake_amount_cents: 1000, settlement_due_at: IN_A_WEEK,
    terms: "You take DAL -3.5. Mike takes PHI +3.5. Week 6, decided by the final score, overtime included.", ...spread("g3", "DAL", -3.5) }),
];

export default function PreviewChallenges() {
  const [commish, setCommish] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const target = useTargetChallenge(true);
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 5));
  const actions: ChallengeActions = {
    onRespond: (id, r) => say(`${r} ${id}`),
    onMarkPaid: (id) => say(`paid ${id}`),
    onConfirm: (id) => say(`confirmed ${id}`),
    onDispute: (id) => say(`review ${id}`),
    onResolve: (id, w) => say(`award ${NAMES[w]} ${id}`),
  };

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="card">
          <div className="card__head">
            <h2>Preview: challenges</h2>
            <div className="segmented" role="group" aria-label="Seat">
              <button className="segmented__opt" data-on={!commish} onClick={() => setCommish(false)}>Manager</button>
              <button className="segmented__opt" data-on={commish} onClick={() => setCommish(true)}>Commissioner</button>
            </div>
          </div>
          {log.length > 0 && <div className="card__body"><span className="eyebrow" data-testid="log">{log[0]}</span></div>}
        </div>

        <div className="grid-auto">
          {CHALLENGES.map((item) => (
            <ChallengeCard
              key={item.id} item={item} userId={ME} busy={false} isCommissioner={commish} profiles={PROFILES}
              nameOf={(id) => (id ? NAMES[id] ?? "Somebody" : "Somebody")}
              weekOf={(id) => (id ? WEEKS[id] ?? null : null)}
              gameOf={(id) => GAMES.find((g) => g.id === id) ?? null}
              target={target === item.id} actions={actions}
            />
          ))}
        </div>
      </main>
    </>
  );
}
