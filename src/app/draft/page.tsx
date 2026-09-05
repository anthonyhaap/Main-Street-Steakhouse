"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock, useTicker } from "@/lib/live";
import { useSession } from "@/lib/session";
import { DRAFT_ID, LEAGUE_ID } from "@/lib/config";
import type { BoardPick, Draft, PoolPlayer, Team } from "@/lib/types";
import { gradePick, marketRankOf, rosterNeeds, teamAtPick, upcomingPicksFor } from "@/lib/draft";
import { playPickMade, playQueueSniped, playYourTurn, useSoundMuted } from "@/lib/sound";
import { TopBar } from "@/components/Shell";
import { Clock } from "@/components/draft/Clock";
import { Board } from "@/components/draft/Board";
import { Pool, type PoolTab } from "@/components/draft/Pool";
import { Rosters } from "@/components/draft/Rosters";
import { Ticker } from "@/components/draft/Ticker";
import { PlayerSheet } from "@/components/player/PlayerSheet";
import { SkeletonRows, useToast } from "@/components/ui";
import { ClipboardList, Star } from "lucide-react";

type State = { draft: Draft; picks: BoardPick[]; teams: Team[]; queueIds: string[] };

/**
 * One bar for everything a phone can show, in the order you reach for it.
 *
 * The room used to stack two segmented strips — Players/Board over
 * Available/Queue/Roster — which is a hundred pixels of chrome, on the screen
 * that has the least of it, to say twice that you are looking at players. The
 * five destinations are five destinations.
 */
type View = "pool" | "board" | "teams";

const VIEWS: { key: View; label: string; poolTab?: PoolTab }[] = [
  { key: "pool", label: "Players", poolTab: "available" },
  { key: "pool", label: "Queue", poolTab: "queue" },
  { key: "pool", label: "Roster", poolTab: "roster" },
  { key: "board", label: "Board" },
  { key: "teams", label: "Teams" },
];

export default function DraftPage() {
  const { team, league, isCommissioner, ready } = useSession();
  const { serverNow, synced } = useServerClock();
  const toast = useToast();
  useTicker(250);

  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("pool");
  /** Which of the two room views the wide layout's left column is showing. */
  const [leftView, setLeftView] = useState<"board" | "teams">("board");
  const [poolTab, setPoolTab] = useState<PoolTab>("available");
  const [lastSeenPick, setLastSeenPick] = useState<number | null>(null);
  /** The player card open over the room, if any. */
  const [openId, setOpenId] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<State> => {
    const supabase = supabaseBrowser();
    const [d, p, t, q] = await Promise.all([
      supabase.from("drafts").select("*").eq("id", DRAFT_ID).single(),
      supabase.from("draft_board").select("*").eq("draft_id", DRAFT_ID).order("pick_number"),
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
      team
        ? supabase.from("draft_queue").select("player_id,rank").eq("team_id", team.id).order("rank")
        : Promise.resolve({ data: [] as { player_id: string }[] }),
    ]);
    if (d.error) throw d.error;
    return {
      draft: d.data as Draft,
      picks: (p.data ?? []) as BoardPick[],
      teams: (t.data ?? []) as Team[],
      queueIds: ((q.data ?? []) as { player_id: string }[]).map((r) => r.player_id),
    };
  }, [team]);

  const { data, status, refetch } = useLive<State>(fetcher, {
    tables: ["draft_picks", "drafts", "teams", "draft_queue"],
    channel: "draft-room",
    pollMs: 15000,
    enabled: ready,
  });

  // The pool is ~1,300 rows that change twice a week. Fetch once; availability
  // is derived from picks rather than re-pulled on every event.
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const { data } = await supabaseBrowser()
        .from("draft_pool").select("*")
        .order("overall_rank", { ascending: true, nullsFirst: false })
        .range(0, 2499);
      setPool((data ?? []) as PoolPlayer[]);
    })();
  }, [ready]);

  const teamCount = data?.teams.length || league?.team_count || 12;
  const onClock = data ? teamAtPick(data.draft.current_pick, data.teams, teamCount) : undefined;
  const nextUp = data ? teamAtPick(data.draft.current_pick + 1, data.teams, teamCount) : undefined;
  const myTurn = !!team && !!onClock && onClock.id === team.id && data?.draft.status === "active";

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const [soundMuted, setSoundMuted] = useSoundMuted();

  // Announce every pick so you can look away from the board — and grade it
  // against ADP, so "he took Bijan" carries whether that was a steal or a
  // reach without a trip to the player card.
  const lastPick = data?.picks[data.picks.length - 1];
  useEffect(() => {
    if (!lastPick) return;
    if (lastSeenPick === null) { setLastSeenPick(lastPick.pick_number); return; }
    if (lastPick.pick_number > lastSeenPick) {
      setLastSeenPick(lastPick.pick_number);
      const grade = gradePick(lastPick.pick_number, marketRankOf(byId.get(lastPick.player_id)));
      const gradeText = grade && grade.label !== "On plan" ? ` — ${grade.label}` : "";

      if (lastPick.team_id === team?.id) {
        playPickMade();
      } else if (data?.queueIds.includes(lastPick.player_id)) {
        playQueueSniped();
        toast("error", `${lastPick.team_name} just took ${lastPick.player_name} off your queue${gradeText}`);
      } else {
        playPickMade();
        toast("info", `${lastPick.team_name} took ${lastPick.player_name}${gradeText}`);
      }
    }
  }, [lastPick, lastSeenPick, team?.id, toast, byId, data?.queueIds]);

  useEffect(() => {
    if (myTurn) { playYourTurn(); toast("ok", "You're on the clock."); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn]);

  const draftedIds = useMemo(() => new Set((data?.picks ?? []).map((p) => p.player_id)), [data]);
  const takenBy = useMemo(() => new Map((data?.picks ?? []).map((p) => [p.player_id, p.team_name])), [data]);
  const myPicks = useMemo(() => (data?.picks ?? []).filter((p) => p.team_id === team?.id), [data, team]);
  const queue = useMemo(
    () => (data?.queueIds ?? []).map((id) => byId.get(id)).filter(Boolean) as PoolPlayer[],
    [data, byId],
  );
  const needs = useMemo(
    () => (league ? rosterNeeds(league.roster_slots ?? [], myPicks) : []),
    [league, myPicks],
  );

  // How far off this manager's next turn is — the number ESPN puts in its
  // banner, and the one that decides whether to open a card or hit Draft.
  const mySlot = team?.draft_slot ?? null;
  const myUpcoming = useMemo(() => {
    if (!data || !mySlot) return [];
    return upcomingPicksFor(mySlot, data.draft.current_pick, data.draft.rounds, teamCount);
  }, [data, mySlot, teamCount]);
  const picksUntilMine = data && myUpcoming[0] != null ? myUpcoming[0] - data.draft.current_pick : null;

  const msLeft =
    data?.draft.status === "active" && data.draft.pick_deadline && synced
      ? new Date(data.draft.pick_deadline).getTime() - serverNow()
      : data?.draft.status === "paused"
        ? (data.draft.remaining_ms ?? null)
        : null;

  const call = useCallback(
    async (fn: string, args: Record<string, unknown>, okText?: string) => {
      setBusy(true);
      const { error } = await supabaseBrowser().rpc(fn, args);
      setBusy(false);
      if (error) {
        // UNIQUE (draft_id, player_id) means a double-draft race surfaces here
        // instead of corrupting the board. Translate it to English.
        toast("error",
          /duplicate key|draft_id_player_id/i.test(error.message) ? "Someone just took him."
          : /not your pick/i.test(error.message) ? "Not your pick."
          : error.message);
      } else if (okText) toast("ok", okText);
      await refetch();
    },
    [refetch, toast],
  );

  const canPick = myTurn || (isCommissioner && data?.draft.status === "active");

  function toggleQueue(id: string) {
    if (!team || !data) return;
    const ids = data.queueIds;
    void call("ff_set_queue", {
      p_team_id: team.id,
      p_player_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    });
  }

  if (!ready || !data) {
    return (
      <>
        <TopBar status={status} />
        <main className="page"><div className="card"><SkeletonRows n={8} /></div></main>
      </>
    );
  }

  if (!team && !isCommissioner) {
    return (
      <>
        <TopBar status={status} />
        <main className="page">
          <div className="card">
            <div className="empty">
              Your account isn&apos;t linked to a team yet.
              <br />
              Ask the commissioner to add your email, then reload.
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar status={status} />
      <main className="page" data-layout="room">
        <div className="draft-room">
          <Clock
            draft={data.draft}
            onClock={onClock}
            nextUp={nextUp}
            myTeamId={team?.id ?? null}
            teamCount={teamCount}
            msLeft={msLeft}
            picksUntilMine={picksUntilMine}
            myUpcoming={myUpcoming}
            isCommissioner={isCommissioner}
            busy={busy}
            onStart={() => call("ff_start_draft", { p_draft_id: DRAFT_ID }, "Draft started.")}
            onPause={() => call("ff_pause_draft", { p_draft_id: DRAFT_ID }, "Draft paused.")}
            onResume={() => call("ff_resume_draft", { p_draft_id: DRAFT_ID }, "Draft resumed.")}
            onUndo={() => call("ff_undo_last_pick", { p_draft_id: DRAFT_ID }, "Last pick undone.")}
            onReset={() => {
              if (window.confirm("Delete every pick and start this draft over from setup? This can't be undone."))
                void call("ff_reset_draft", { p_draft_id: DRAFT_ID }, "Draft reset.");
            }}
            soundMuted={soundMuted}
            onToggleSound={() => setSoundMuted(!soundMuted)}
          />

          {/* Before the first pick there's nothing to run, and the mock room is
              the only thing worth doing on this screen — so it gets the space.
              Once the draft is live it would be sitting on top of the board,
              and the ticker takes the room instead. */}
          {data.draft.status === "setup" ? (
            <section className="card">
              <div className="card__head" style={{ alignItems: "center", gap: "var(--s4)", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
                  <span className="icon-box" aria-hidden><ClipboardList size={18} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="eyebrow" style={{ color: "var(--gold)" }}>Practice room</div>
                    <strong>Rehearse before draft night</strong>
                    <p style={{ color: "var(--muted)", margin: "3px 0 0" }}>
                      Run a private mock with the live player pool. It never changes the league draft or rosters.
                    </p>
                  </div>
                </div>
                <Link className="btn" data-v="primary" href="/mock-draft" style={{ marginLeft: "auto" }}>
                  Start mock draft
                </Link>
              </div>
            </section>
          ) : (
            <Ticker
              picks={data.picks}
              poolById={byId}
              myTeamId={team?.id ?? null}
              teamCount={teamCount}
              onOpen={setOpenId}
            />
          )}

          {/* A phone shows one pane at a time; a desktop shows the pool
              permanently and switches only the left column. Same state, two
              controls, so the two layouts never disagree about what's open. */}
          <div className="draft-tabs draft-only-narrow">
            <div className="segmented">
              {VIEWS.map((v) => {
                const on = v.key === "pool" ? view === "pool" && poolTab === v.poolTab : view === v.key;
                const count = v.poolTab === "queue" ? queue.filter((p) => !draftedIds.has(p.id)).length
                  : v.poolTab === "roster" ? myPicks.length : 0;
                return (
                  <button key={v.label} className="segmented__opt" data-on={on}
                    onClick={() => {
                      setView(v.key);
                      if (v.key === "pool") setPoolTab(v.poolTab ?? "available");
                      else setLeftView(v.key as "board" | "teams");
                    }}>
                    {v.label}{count ? <i className="pool__scarce num">{count}</i> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="draft-tabs draft-only-wide">
            <div className="segmented">
              {(["board", "teams"] as const).map((v) => (
                <button key={v} className="segmented__opt" data-on={leftView === v}
                  onClick={() => { setLeftView(v); if (view !== "pool") setView(v); }}>
                  {v === "board" ? "The board" : "Team rosters"}
                </button>
              ))}
            </div>
          </div>

          <div className="draft-grid">
            {/* On a wide screen the left column carries the board and the team
                rosters behind one toggle; on a phone all three are tabs. */}
            <div className="draft-pane" data-show={view !== "pool"}>
              {leftView === "teams" ? (
                <Rosters
                  teams={data.teams}
                  picks={data.picks}
                  myTeamId={team?.id ?? null}
                  slots={league?.roster_slots ?? []}
                  poolById={byId}
                  teamCount={teamCount}
                  rounds={data.draft.rounds}
                  currentPick={data.draft.current_pick}
                  onOpen={setOpenId}
                />
              ) : (
                <Board draft={data.draft} teams={data.teams} picks={data.picks} myTeamId={team?.id ?? null} poolById={byId} onOpen={setOpenId} />
              )}
            </div>
            <div className="draft-pane" data-show={view === "pool"}>
              <Pool
                pool={pool}
                currentPick={data.draft.current_pick}
                draftedIds={draftedIds}
                takenBy={takenBy}
                allPicks={data.picks}
                queue={queue}
                myPicks={myPicks}
                slots={league?.roster_slots ?? []}
                needs={needs}
                tab={poolTab}
                onTabChange={setPoolTab}
                canPick={canPick}
                busy={busy}
                onOpen={setOpenId}
                onDraft={(p) => call("ff_pick_for_my_team", { p_draft_id: DRAFT_ID, p_player_id: p.id }, `Drafted ${p.full_name}.`)}
                onQueueChange={(ids) => team ? call("ff_set_queue", { p_team_id: team.id, p_player_ids: ids }) : undefined}
              />
            </div>
          </div>
        </div>
      </main>

      {openId && (() => {
        const p = byId.get(openId);
        const drafted = draftedIds.has(openId);
        const queued = data.queueIds.includes(openId);
        // What he'd grade if taken right now — the same read the board gives
        // after the fact, offered before you click Draft instead of after.
        const grade = !drafted && p ? gradePick(data.draft.current_pick, marketRankOf(p)) : null;
        return (
          <PlayerSheet
            playerId={openId}
            onClose={() => setOpenId(null)}
            preview={grade && grade.label !== "On plan" && (
              <div className="note" data-kind={grade.tone === "danger" ? "error" : grade.tone === "ok" ? "ok" : "info"}>
                Taken at pick {data.draft.current_pick}, he&apos;d grade <b>{grade.label}</b> —{" "}
                {Math.abs(grade.delta)} picks {grade.delta > 0 ? "past" : "ahead of"} his ADP.
              </div>
            )}
            actions={
              drafted ? (
                <>
                  {queued && <Star size={14} fill="none" style={{ color: "var(--faint)" }} aria-hidden />}
                  <span className="badge" data-tone="neutral">Taken · {takenBy.get(openId)}</span>
                </>
              ) : (
                <>
                  {team && (
                    <button className="btn" data-size="sm" onClick={() => toggleQueue(openId)} disabled={busy}
                      style={queued ? { color: "var(--gold)" } : undefined}>
                      <Star size={13} fill={queued ? "var(--gold)" : "none"} /> {queued ? "Queued" : "Queue"}
                    </button>
                  )}
                  <button className="btn" data-v="primary" data-size="sm" disabled={!canPick || busy || !p}
                    title={canPick ? undefined : picksUntilMine ? `Your pick in ${picksUntilMine}` : "Not your pick"}
                    onClick={() => {
                      if (!p) return;
                      setOpenId(null);
                      void call("ff_pick_for_my_team", { p_draft_id: DRAFT_ID, p_player_id: p.id }, `Drafted ${p.full_name}.`);
                    }}>
                    Draft{p ? ` ${p.full_name.split(" ").slice(-1)[0]}` : ""}
                  </button>
                </>
              )
            }
          />
        );
      })()}
    </>
  );
}
