import { supabaseServer } from "@/lib/supabase/server";
import type { SundayBoard } from "@/lib/sunday";
import { loadSunday } from "@/lib/sunday-load";
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
  // A failure here is not the page's failure: the browser fetches again on
  // mount and shows its own error if that fails too.
  const initial: SundayBoard | null = await loadSunday(supabase, week).catch(() => null);

  return <SundayLive initial={initial} week={week} />;
}
