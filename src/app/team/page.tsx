"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { useCrests, useSession } from "@/lib/session";
import { useWire } from "@/lib/nfl/wire";
import { useWeather } from "@/lib/nfl/weather";
import { useMatchups } from "@/lib/nfl/matchup";
import type { HubPlayer, TeamHub } from "@/lib/nfl/types";
import type { Team } from "@/lib/types";
import { TopBar } from "@/components/Shell";
import { SkeletonRows, useToast } from "@/components/ui";
import { TeamDesk, slotOk, type MoveTarget } from "@/components/team/TeamDesk";
import { EditTeam } from "@/components/team/EditTeam";

/**
 * The desk, for the reader's own team or for anybody else's.
 *
 * `/team` is your desk. `/team?id=<team>` is somebody else's, drawn with the
 * same components in read-only mode: the lineup, the form, the wire read
 * against that roster and the coach's opinion of it are all there to look at,
 * and nothing on it can be moved, edited or set. Any manager in the league can
 * open any other manager's team — the standings, the power rankings and the
 * opponent's name in the hero all lead here, and the picker in the hero walks
 * the whole league without leaving the page.
 *
 * An id that is not a team in this league falls back to your own desk rather
 * than an error: a stale link should land somewhere useful.
 */
function Desk() {
  const { ready, team, teams, reload } = useSession();
  const router = useRouter();
  const crestOf = useCrests();
  const toast = useToast();
  const [week, setWeek] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  // Whose desk this is. The URL decides, the session confirms: an id must name
  // a team in the league, and your own id is just `/team` under another name.
  const asked = useSearchParams().get("id");
  const subject: Team | null = useMemo(
    () => (asked && teams.find((t) => t.id === asked)) || team,
    [asked, teams, team],
  );
  const mine = !!subject && !!team && subject.id === team.id;
  const subjectId = subject?.id ?? null;

  // A move in flight belongs to the desk it started on. It is stored with that
  // desk's id, so switching teams abandons it without an effect to clear it.
  const [lifted, setLifted] = useState<{ player: HubPlayer; of: string } | null>(null);
  const moving = lifted && lifted.of === subjectId ? lifted.player : null;
  const setMoving = useCallback(
    (p: HubPlayer | null) => setLifted(p && subjectId ? { player: p, of: subjectId } : null),
    [subjectId],
  );

  useEffect(() => {
    if (!ready) return;
    void supabaseBrowser().rpc("ff_current_week").then(({ data }) => setWeek((data as number) ?? 1));
  }, [ready]);

  const fetcher = useCallback(async () => {
    if (!subjectId || week === null) return null;
    const { data, error } = await supabaseBrowser()
      .rpc("ff_team_hub", { p_team_id: subjectId, p_week: week });
    if (error) throw new Error(error.message);
    return data as TeamHub;
  }, [subjectId, week]);

  const { data: hub, status, error, refetch, mutate } = useLive<TeamHub | null>(fetcher, {
    tables: ["rosters", "matchups"],
    channel: "my-team",
    pollMs: 30000,
    enabled: ready && !!subjectId && week !== null,
  });

  // `useLive` refetches on mount, on a row change, on reconnect and on a
  // timer — not when the question changes. Changing the week or the team is a
  // new question.
  useEffect(() => {
    if (ready && subjectId && week !== null) void refetch();
  }, [ready, subjectId, week, refetch]);

  const { data: wire } = useWire(ready);

  // The two signals the hub does not carry: what the sky is doing over each
  // stadium, and how this week's projection compares with the rest of the
  // player's own season. Both feed the lineup coach and nothing else, and both
  // are allowed to come back empty — it says so when they do.
  const { weather } = useWeather(hub?.roster ?? null, ready && !!hub);
  const { data: matchups } = useMatchups(
    hub?.roster ?? null, hub?.league.season ?? null, week, ready && !!hub,
  );

  /** Replaced rather than pushed: Back should leave the desk, not walk back
   *  through every team looked at on the way. */
  const look = useCallback((id: string) => {
    router.replace(team && id === team.id ? "/team" : `/team?id=${id}`);
  }, [router, team]);

  /**
   * Set several slots at once — what the coach's one button does.
   *
   * No optimism here, unlike a single drag: nine rows moving at once on a plan
   * the server might reject reads as chaos, and the round trip is one call. The
   * refetch afterwards is the source of truth either way.
   */
  async function setLineup(assignments: Record<string, string>) {
    if (!mine || !team || week === null || Object.keys(assignments).length === 0) return;

    setBusy(true);
    const { error: rpcError } = await supabaseBrowser().rpc("ff_set_lineup", {
      p_team_id: team.id, p_week: week, p_assignments: assignments,
    });
    setBusy(false);

    if (rpcError) toast("error", rpcError.message);
    else {
      const n = Object.keys(assignments).length;
      toast("ok", `Lineup set — ${n} ${n === 1 ? "change" : "changes"}.`);
    }
    await refetch();
  }

  async function drop(target: MoveTarget) {
    if (!moving || !mine || !team || week === null) return;
    if (!slotOk(target.slot, moving.position)) {
      toast("error", `A ${moving.position} can't play at ${target.slot}.`);
      return;
    }
    if (target.player?.player_id === moving.player_id) {
      setMoving(null);
      return;
    }

    // Swap: the man already in the slot takes the one being vacated.
    const assignments: Record<string, string> = { [moving.player_id]: target.slot };
    if (target.player) assignments[target.player.player_id] = moving.slot;

    // Optimistic: the row moves on the tap, not on the round trip. The
    // server's answer replaces it either way — the refetch below confirms
    // the move, and an error puts the old lineup back.
    const before = hub;
    if (hub) {
      const swapped = hub.roster.map((p) =>
        p.player_id === moving.player_id ? { ...p, slot: target.slot }
        : target.player && p.player_id === target.player.player_id ? { ...p, slot: moving.slot }
        : p);
      mutate({ ...hub, roster: swapped });
    }
    setMoving(null);

    setBusy(true);
    const { error: rpcError } = await supabaseBrowser().rpc("ff_set_lineup", {
      p_team_id: team.id, p_week: week, p_assignments: assignments,
    });
    setBusy(false);
    if (rpcError) {
      mutate(before);
      toast("error", rpcError.message);
    } else {
      toast("ok", `${moving.full_name} → ${target.slot === "BN" ? "bench" : target.slot}.`);
    }
    await refetch();
  }

  if (!ready || (subject && !hub && !error)) {
    return (
      <>
        <TopBar status={status} />
        <main className="page"><div className="card"><SkeletonRows n={10} /></div></main>
      </>
    );
  }

  if (!subject || !hub) {
    return (
      <>
        <TopBar status={status} />
        <main className="page">
          <div className="card">
            {error
              ? <div className="note" data-kind="error">Couldn&apos;t load {mine ? "your" : "this"} team: {error}</div>
              : <div className="empty">You aren&apos;t linked to a team yet.</div>}
          </div>
        </main>
      </>
    );
  }

  // The hub the desk is drawing may be a request behind the picker while a
  // new team loads; the picker follows the URL, the desk follows the data.
  const stale = hub.team.id !== subject.id;

  return (
    <>
      <TopBar status={status} />
      <div style={stale ? { opacity: 0.55, transition: "opacity 0.2s" } : undefined}>
        <TeamDesk
          hub={hub}
          wire={wire}
          moving={moving}
          busy={busy}
          readOnly={hub.team.id !== team?.id}
          crest={crestOf(hub.team.id)}
          oppCrest={crestOf(hub.matchup?.opponent.id)}
          weather={weather}
          matchups={matchups}
          picker={<TeamPicker teams={teams} value={subject.id} mine={team?.id ?? null} onPick={look} />}
          onPickUp={setMoving}
          onCancelMove={() => setMoving(null)}
          onDrop={drop}
          onWeek={(w) => { setMoving(null); setWeek(w); }}
          onEdit={mine ? () => setEditing(true) : undefined}
          onSetLineup={mine ? setLineup : undefined}
        />
      </div>
      {editing && mine && team && (
        <EditTeam
          team={team}
          onClose={() => setEditing(false)}
          // The name and the crest are on every screen in the app, so the whole
          // session is reloaded rather than just this page's hub.
          onSaved={async () => { await reload(); await refetch(); }}
        />
      )}
    </>
  );
}

/**
 * Whose desk to look at. A native select, because it is twelve names and the
 * phone's own picker handles twelve names better than anything drawn here.
 */
function TeamPicker({ teams, value, mine, onPick }: {
  teams: Team[];
  value: string;
  mine: string | null;
  onPick: (id: string) => void;
}) {
  if (teams.length < 2) return null;
  return (
    <select
      className="field"
      aria-label="Look at a team"
      value={value}
      onChange={(e) => onPick(e.target.value)}
      style={{ width: "auto", minHeight: 30, padding: "4px 8px", fontSize: "var(--t-small)" }}
    >
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}{t.id === mine ? " (my team)" : t.manager_name ? ` — ${t.manager_name}` : ""}
        </option>
      ))}
    </select>
  );
}

export default function TeamPage() {
  // `useSearchParams` client-renders the tree it sits in, so the skeleton is
  // the fallback as well as the loading state: the chrome is in the
  // prerendered HTML and only the desk waits.
  return (
    <Suspense
      fallback={
        <>
          <TopBar />
          <main className="page"><div className="card"><SkeletonRows n={10} /></div></main>
        </>
      }
    >
      <Desk />
    </Suspense>
  );
}
