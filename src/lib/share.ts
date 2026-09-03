import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";

/** Shape of ff_share_card(matchup_id). */
export type ShareCard = {
  league: string;
  season: number;
  week: number;
  final: boolean;
  home: { name: string; manager: string | null; points: number; crest: string | null };
  away: { name: string; manager: string | null; points: number; crest: string | null };
  top: { full_name: string; position: string; points: number; team: string } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read one matchup without a session. The share page and its image are
 * fetched by whichever messaging app unfurls the link, which holds no
 * cookie, so this goes out as anon and reaches the one function anon may
 * call. Anything that is not a UUID is refused before it costs a request.
 */
export async function shareCard(id: string): Promise<ShareCard | null> {
  if (!UUID.test(id)) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("ff_share_card", { p_matchup_id: id });
  if (error || !data) return null;
  return data as ShareCard;
}

/** "Dave" on a card, never a null. */
export const shareName = (s: { name: string; manager: string | null }) =>
  s.manager?.trim().split(/\s+/)[0] || s.name;

/** The card's own headline. */
export function shareTitle(c: ShareCard): string {
  const started = c.home.points + c.away.points > 0;
  const [w, l] = c.home.points >= c.away.points ? [c.home, c.away] : [c.away, c.home];
  if (!started) return `${shareName(c.home)} vs. ${shareName(c.away)} · Week ${c.week}`;
  return `${shareName(w)} ${Number(w.points).toFixed(1)} — ${shareName(l)} ${Number(l.points).toFixed(1)} · Week ${c.week}`;
}
