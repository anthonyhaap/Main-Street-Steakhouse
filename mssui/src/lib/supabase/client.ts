"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";

let cached: SupabaseClient | null = null;

/**
 * One browser client for the whole tab. Realtime is capped at 20 events/sec —
 * a 12-team draft never approaches that, and the cap keeps a runaway loop from
 * saturating the socket.
 */
export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return cached;
}
