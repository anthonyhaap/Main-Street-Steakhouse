"use client";

/**
 * The draft room, pointed at a television.
 *
 * Its own address rather than a mode on /draft, because that is how it gets
 * used: somebody types it once into whatever browser the TV has, on the night,
 * and never touches it again. A query parameter on the room would mean the
 * back button and every internal link could drop the television out of TV mode
 * halfway through round four.
 *
 * Two things a screen in the corner needs that a phone does not:
 *
 *   A wake lock, or the television dims in the middle of somebody's pick. The
 *   API is not everywhere, and it is dropped whenever the tab is hidden, so it
 *   is re-taken on visibility rather than acquired once and assumed.
 *
 *   Fullscreen, offered rather than forced — a browser will only enter it from
 *   a real click, and a TV's chrome is worth losing.
 *
 * It reads the same three tables the draft room reads, under the same realtime
 * contract, and renders through the pure TvBoard so the fixture at
 * /preview/draft-tv is the same screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive, useServerClock, useTicker } from "@/lib/live";
import { useSession } from "@/lib/session";
import { DRAFT_ID, LEAGUE_ID } from "@/lib/config";
import type { BoardPick, Draft, PoolPlayer, Team } from "@/lib/types";
import { TvBoard, type TvState } from "@/components/draft/TvBoard";

export default function DraftTvPage() {
  const { ready } = useSession();
  const { serverNow, synced } = useServerClock();
  useTicker(250);

  const fetcher = useCallback(async (): Promise<TvState> => {
    const supabase = supabaseBrowser();
    const [d, p, t] = await Promise.all([
      supabase.from("drafts").select("*").eq("id", DRAFT_ID).single(),
      supabase.from("draft_board").select("*").eq("draft_id", DRAFT_ID).order("pick_number"),
      supabase.from("teams").select("*").eq("league_id", LEAGUE_ID).order("draft_slot"),
    ]);
    if (d.error) throw d.error;
    return {
      draft: d.data as Draft,
      picks: (p.data ?? []) as BoardPick[],
      teams: (t.data ?? []) as Team[],
    };
  }, []);

  const { data, error } = useLive<TvState>(fetcher, {
    tables: ["draft_picks", "drafts", "teams"],
    channel: "draft-tv",
    pollMs: 15000,
    enabled: ready,
  });

  // Only what a grade needs, and only once: the market ranks do not move
  // during a draft.
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void supabaseBrowser()
      .from("draft_pool").select("*")
      .order("overall_rank", { ascending: true, nullsFirst: false })
      .range(0, 2499)
      .then(({ data: rows }) => { if (alive) setPool((rows ?? []) as PoolPlayer[]); });
    return () => { alive = false; };
  }, [ready]);

  const poolById = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);

  /* ------------------------------------------------------- the wake lock -- */
  const lock = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    let dropped = false;
    const take = async () => {
      // Not in every browser, and it throws rather than returning null when
      // the document is hidden. A television that dims is a worse outcome than
      // an unhandled rejection, but only just — so it fails quietly and tries
      // again the next time the tab is visible.
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      try {
        lock.current = await navigator.wakeLock.request("screen");
      } catch {
        /* denied, unsupported, or the tab lost focus mid-request */
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible" && !dropped) void take(); };

    void take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dropped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, []);

  /* ------------------------------------------------------- the fullscreen -- */
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* a browser that refuses is a browser that keeps its chrome */
    }
  };

  const msLeft =
    data?.draft.status === "active" && data.draft.pick_deadline && synced
      ? new Date(data.draft.pick_deadline).getTime() - serverNow()
      : data?.draft.status === "paused"
        ? (data.draft.remaining_ms ?? null)
        : null;

  return (
    <main className="tv-page">
      <button
        className="tv-full"
        onClick={() => void toggleFull()}
        aria-label={full ? "Leave fullscreen" : "Go fullscreen"}
      >
        {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>

      {!data && error && <div className="tv__none tv__boot">The draft didn&apos;t load: {error}</div>}
      {!data && !error && <div className="tv__none tv__boot">Opening the room…</div>}
      {data && <TvBoard state={data} msLeft={msLeft} poolById={poolById} />}
    </main>
  );
}
