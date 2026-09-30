import { supabaseServer } from "@/lib/supabase/server";
import { LEAGUE_ID } from "@/lib/config";
import type { SundayBoard } from "@/lib/sunday";
import { SundayLive } from "@/components/sunday/SundayLive";

/**
 * Steakhouse Sunday, rendered on the server.
 *
 * One RPC on the session cookie — `ff_sunday`, the whole board with the NFL
 * slate beside it — so the HTML that arrives is already the game center, and
 * the browser's first request is a refetch rather than the only one. `/`
 * does the same with the briefing, for the same reason.
 *
 * `?week=11` opens a past Sunday; its recap and board are still here.
 */
export default async function Page({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const asked = Number((await searchParams).week);
  const week = Number.isInteger(asked) && asked >= 1 ? asked : null;

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("ff_sunday", { p_league_id: LEAGUE_ID, p_week: week });
  const initial: SundayBoard | null = !error && data ? (data as SundayBoard) : null;

  return <SundayLive initial={initial} week={week} />;
}
