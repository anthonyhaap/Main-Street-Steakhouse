"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

export type WireStatus = "connecting" | "live" | "stale";

type Options = {
  /** Tables to watch. Any change triggers a debounced refetch. */
  tables: string[];
  /** Unique channel name. */
  channel: string;
  /** Safety-net poll interval in ms. Set 0 to disable. */
  pollMs?: number;
  /** Skip fetching entirely until this is true (e.g. waiting on auth). */
  enabled?: boolean;
};

/**
 * The contract this hook exists to keep: *whenever* you open the app, you see
 * current state — not whatever was true when a socket last delivered an event.
 *
 * It gets there four ways, because any one of them alone leaves a hole:
 *   1. Fetch on mount.                  (you just opened the page)
 *   2. Refetch on realtime change.      (something happened while you watched)
 *   3. Refetch on reconnect.            (the socket dropped and events were missed)
 *   4. Refetch on tab focus + poll.     (laptop slept; the socket died quietly)
 *
 * Postgres change events are used only as a *signal to refetch*, never as the
 * data itself. That costs one extra round trip and buys immunity to dropped,
 * duplicated, and out-of-order events — the failure mode that makes most
 * homegrown draft rooms disagree with each other at pick 40.
 */
export function useLive<T>(fetcher: () => Promise<T>, opts: Options) {
  const { tables, channel, pollMs = 20000, enabled = true } = opts;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<WireStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const inflight = useRef(false);
  const queued = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    // Collapse concurrent refetches: one in flight, at most one queued.
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    try {
      const next = await fetcherRef.current();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      inflight.current = false;
      if (queued.current) {
        queued.current = false;
        void refetch();
      }
    }
  }, [enabled]);

  const nudge = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    // 90ms: long enough to coalesce the burst of row events one pick produces,
    // short enough that the board still feels instant.
    debounce.current = setTimeout(() => void refetch(), 90);
  }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
  }, [enabled, refetch]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = supabaseBrowser();
    let ch: RealtimeChannel | null = supabase.channel(channel);

    for (const table of tables) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, nudge);
    }

    ch.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        setStatus("live");
        // A fresh subscription means we may have missed events while down.
        void refetch();
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        setStatus("stale");
      }
    });

    return () => {
      if (ch) void supabase.removeChannel(ch);
      ch = null;
    };
    // `tables` is a literal array at every call site; join it so a new array
    // identity per render doesn't tear down the channel on every commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, tables.join(","), enabled, nudge, refetch]);

  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [enabled, refetch]);

  useEffect(() => {
    if (!enabled || !pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, pollMs);
    return () => clearInterval(id);
  }, [enabled, pollMs, refetch]);

  return { data, status, error, loading, refetch };
}

/**
 * Draft clocks are settled by the server (`drafts.pick_deadline` + a pg_cron
 * tick). The browser only *renders* the countdown, so it must render it in
 * server time. This measures the offset once on mount and re-checks every
 * minute; a manager with a 40-second-fast laptop still sees the true clock.
 */
export function useServerClock() {
  const [offsetMs, setOffsetMs] = useState(0);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const supabase = supabaseBrowser();
      const sentAt = Date.now();
      const { data, error } = await supabase.rpc("ff_now");
      if (!alive || error || !data) return;
      const rtt = Date.now() - sentAt;
      // Assume symmetric latency: the server's `now()` was true at rtt/2 ago.
      const serverNow = new Date(data as string).getTime() + rtt / 2;
      setOffsetMs(serverNow - Date.now());
      setSynced(true);
    };
    void sync();
    const id = setInterval(sync, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetMs, [offsetMs]);
  return { serverNow, offsetMs, synced };
}

/** Ticks every `ms` and returns a counter — drives countdown re-renders. */
export function useTicker(ms = 250) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
