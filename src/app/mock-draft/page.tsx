"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { Board } from "@/components/draft/Board";
import { Pool } from "@/components/draft/Pool";
import { PlayerSheet } from "@/components/player/PlayerSheet";
import { TopBar } from "@/components/Shell";
import { SkeletonRows, useToast } from "@/components/ui";
import { rosterNeeds, snakeSlot } from "@/lib/draft";
import { LEAGUE_ID } from "@/lib/config";
import { mockOpponentPick } from "@/lib/mock-draft";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { BoardPick, Draft, PoolPlayer, Team } from "@/lib/types";

const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BN", "BN", "BN", "BN", "BN", "BN"];

function mockTeams(count: number, real: Team[]): Team[] {
  return Array.from({ length: count }, (_, index) => {
    const found = real.find((team) => team.draft_slot === index + 1) ?? real[index];
    return {
      id: `mock-team-${index + 1}`,
      league_id: "mock",
      name: found?.name ?? `Table ${index + 1}`,
      owner_id: null,
      owner_email: null,
      manager_name: found?.manager_name ?? null,
      logo_path: found?.logo_path ?? null,
      draft_slot: index + 1,
    };
  });
}

function boardPick(player: PoolPlayer, pickNumber: number, teams: Team[], teamCount: number, userSlot: number): BoardPick {
  const slot = snakeSlot(pickNumber, teamCount);
  const team = teams[slot - 1];
  return {
    draft_id: "mock",
    pick_number: pickNumber,
    round: Math.floor((pickNumber - 1) / teamCount) + 1,
    is_autopick: slot !== userSlot,
    made_at: new Date().toISOString(),
    team_id: team.id,
    team_name: team.name,
    draft_slot: slot,
    player_id: player.id,
    player_name: player.full_name,
    position: player.position,
    nfl_team: player.nfl_team,
    espn_id: player.espn_id,
  };
}

export default function MockDraftPage() {
  const { league, ready } = useSession();
  const toast = useToast();
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [realTeams, setRealTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [slot, setSlot] = useState(1);
  const [started, setStarted] = useState(false);
  const [picks, setPicks] = useState<BoardPick[]>([]);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "pool">("pool");

  const teamCount = league?.team_count ?? 12;
  const slots = league?.roster_slots?.length ? league.roster_slots : DEFAULT_SLOTS;
  const rounds = slots.length;
  const total = teamCount * rounds;
  const teams = useMemo(() => mockTeams(teamCount, realTeams), [teamCount, realTeams]);
  const myTeamId = teams[slot - 1]?.id ?? "mock-team-1";

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const supabase = supabaseBrowser();
      const [players, teamRows] = await Promise.all([
        supabase.from("draft_pool").select("*").order("overall_rank", { ascending: true, nullsFirst: false }).range(0, 2499),
        supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
      ]);
      if (players.error) toast("error", players.error.message);
      setPool((players.data ?? []) as PoolPlayer[]);
      setRealTeams((teamRows.data ?? []) as Team[]);
      setLoading(false);
    })();
  }, [ready, toast]);

  const draftedIds = useMemo(() => new Set(picks.map((pick) => pick.player_id)), [picks]);
  const takenBy = useMemo(() => new Map(picks.map((pick) => [pick.player_id, pick.team_name])), [picks]);
  const myPicks = useMemo(() => picks.filter((pick) => pick.team_id === myTeamId), [myTeamId, picks]);
  const byId = useMemo(() => new Map(pool.map((player) => [player.id, player])), [pool]);
  const queue = useMemo(() => queueIds.map((id) => byId.get(id)).filter(Boolean) as PoolPlayer[], [byId, queueIds]);
  const needs = useMemo(() => rosterNeeds(slots, myPicks), [slots, myPicks]);
  const currentPick = Math.min(picks.length + 1, total);
  const complete = picks.length >= total;
  const myTurn = started && !complete && snakeSlot(currentPick, teamCount) === slot;

  const advanceOpponents = useCallback((from: BoardPick[]) => {
    const next = [...from];
    const used = new Set(next.map((pick) => pick.player_id));
    while (next.length < total && snakeSlot(next.length + 1, teamCount) !== slot) {
      const pickNumber = next.length + 1;
      const cpuSlot = snakeSlot(pickNumber, teamCount);
      const cpuId = teams[cpuSlot - 1].id;
      const player = mockOpponentPick(pool, used, slots, next.filter((pick) => pick.team_id === cpuId));
      if (!player) break;
      next.push(boardPick(player, pickNumber, teams, teamCount, slot));
      used.add(player.id);
    }
    setPicks(next);
  }, [pool, slot, slots, teamCount, teams, total]);

  function start() {
    setStarted(true);
    setPicks([]);
    advanceOpponents([]);
  }

  function draftPlayer(player: PoolPlayer) {
    if (!myTurn || draftedIds.has(player.id)) return;
    const next = [...picks, boardPick(player, currentPick, teams, teamCount, slot)];
    setQueueIds((ids) => ids.filter((id) => id !== player.id));
    advanceOpponents(next);
  }

  const draft: Draft = {
    id: "mock", league_id: "mock", status: complete ? "complete" : started ? "active" : "setup",
    type: "snake", rounds, pick_seconds: 0, current_pick: currentPick, pick_deadline: null,
    remaining_ms: null, started_at: started ? new Date().toISOString() : null,
    completed_at: complete ? new Date().toISOString() : null,
  };

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="card" style={{ marginBottom: "var(--s4)" }}>
          <div className="card__head" style={{ alignItems: "flex-start", gap: "var(--s4)", flexWrap: "wrap" }}>
            <div>
              <div className="eyebrow" style={{ color: "var(--gold)", marginBottom: 4 }}>Practice room</div>
              <h1 style={{ fontSize: "var(--t-title)", margin: 0 }}>Mock draft</h1>
              <p style={{ color: "var(--muted)", margin: "6px 0 0", maxWidth: 620 }}>
                Rehearse a full snake draft against ADP-driven opponents. Nothing here touches the live draft or your real roster.
              </p>
            </div>
            <div style={{ display: "flex", gap: "var(--s3)", alignItems: "end", flexWrap: "wrap", marginLeft: "auto" }}>
              {!started && (
                <label className="eyebrow">Your seat
                  <select className="field" aria-label="Your draft seat" value={slot} onChange={(event) => setSlot(Number(event.target.value))} style={{ display: "block", marginTop: 5, minWidth: 110 }}>
                    {Array.from({ length: teamCount }, (_, index) => <option key={index + 1} value={index + 1}>Pick {index + 1}</option>)}
                  </select>
                </label>
              )}
              <button className="btn" data-v="primary" disabled={loading || pool.length === 0} onClick={start}>
                {started ? <RotateCcw size={15} /> : <Sparkles size={15} />}
                {started ? "Restart" : "Start mock"}
              </button>
            </div>
          </div>
          {started && (
            <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", gap: "var(--s3)", flexWrap: "wrap" }}>
              <strong>{complete ? "Mock complete" : myTurn ? "You are on the clock" : "Simulating opponents…"}</strong>
              <span className="eyebrow"><span className="num">{picks.length}</span> / {total} picks · seat {slot}</span>
            </div>
          )}
        </section>

        {loading ? <div className="card"><SkeletonRows n={8} /></div> : !started ? (
          <div className="card"><div className="empty">Choose your draft seat, then start the rehearsal.</div></div>
        ) : (
          <>
            <div data-only="narrow" style={{ display: "flex", justifyContent: "center", marginBottom: "var(--s3)" }}>
              <div className="segmented">
                {(["pool", "board"] as const).map((item) => <button key={item} className="segmented__opt" data-on={view === item} onClick={() => setView(item)}>{item === "pool" ? "Players" : "Board"}</button>)}
              </div>
            </div>
            <div className="draft-grid">
              <div className="draft-pane" data-show={view === "board"}><Board draft={draft} teams={teams} picks={picks} myTeamId={myTeamId} onOpen={setOpenId} /></div>
              <div className="draft-pane" data-show={view === "pool"}>
                <Pool pool={pool} draftedIds={draftedIds} takenBy={takenBy} queue={queue} myPicks={myPicks} slots={slots} needs={needs} canPick={myTurn} busy={false} onOpen={setOpenId} onDraft={draftPlayer} onQueueChange={setQueueIds} />
              </div>
            </div>
          </>
        )}
      </main>
      <style>{`
        .draft-grid { display: grid; gap: var(--s4); min-height: 0; }
        .draft-pane { min-height: 0; display: flex; }
        .draft-pane > * { flex: 1; }
        @media (max-width: 1099px) {
          .draft-pane[data-show="false"] { display: none; }
          .draft-pane > * { max-height: calc(100dvh - 300px); }
        }
        @media (min-width: 1100px) {
          [data-only="narrow"] { display: none !important; }
          .draft-grid { grid-template-columns: minmax(0, 1.1fr) minmax(430px, 0.9fr); }
          .draft-pane[data-show="false"] { display: flex; }
          .draft-pane > * { max-height: calc(100dvh - 250px); }
        }
      `}</style>
      {openId && <PlayerSheet playerId={openId} onClose={() => setOpenId(null)} actions={myTurn && !draftedIds.has(openId) ? <button className="btn" data-v="primary" data-size="sm" onClick={() => { const player = byId.get(openId); if (player) { draftPlayer(player); setOpenId(null); } }}>Draft player</button> : undefined} />}
    </>
  );
}
