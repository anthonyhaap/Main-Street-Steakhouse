import { createClient } from "@supabase/supabase-js";
import { SITE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";

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

/* --------------------------------------------------- sharing a live card -- */

/**
 * Where a link should point when the page is asked to build one.
 *
 * `location.origin` on a real page, and the canonical site otherwise — a
 * fixture, a test runner or a server render all produce something that is not
 * a URL anybody can paste into a chat.
 */
export function shareOrigin(): string {
  return typeof location !== "undefined" && location.origin.startsWith("http")
    ? location.origin
    : SITE_URL;
}

/**
 * One scoreboard card, written for a group chat.
 *
 * The same three lines the briefing's `matchupText` sends on a Tuesday —
 * league and week, the two sides, the link — so the chat hears one voice
 * whichever screen the message was sent from. The link is what does the
 * visual work: /share/matchup/[id] carries an opengraph image, and every
 * messaging app in the league unfurls it.
 */
export function scoreCardText(
  c: {
    id: string;
    home: { name: string; manager_name: string | null; points: number; proj: number };
    away: { name: string; manager_name: string | null; points: number; proj: number };
  },
  league: string,
  week: number,
  origin: string,
): string {
  const name = (s: { name: string; manager_name: string | null }) =>
    s.manager_name?.trim().split(/\s+/)[0] || s.name;
  const n1 = Number(c.home.points), n2 = Number(c.away.points);
  const started = n1 + n2 > 0;
  const one = (x: number) => x.toFixed(1);

  // Before kickoff there is no score to send, and sending "0.0 — 0.0" is worse
  // than sending what the two lineups are projected to do.
  const line = started
    ? `${name(c.home)} ${one(n1)} — ${name(c.away)} ${one(n2)}`
    : `${name(c.home)} (proj. ${one(Number(c.home.proj))}) vs. ${name(c.away)} (proj. ${one(Number(c.away.proj))})`;

  return `${league} · Week ${week}\n${line}\n${origin}/share/matchup/${c.id}`;
}
