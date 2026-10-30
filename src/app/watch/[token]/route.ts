import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** What ff_create_watch_link mints: 64 hex characters. */
const TOKEN = /^[0-9a-f]{64}$/;

/**
 * A watch link, opened.
 *
 * The commissioner hands out `/watch/<token>`; whoever opens it is signed in
 * anonymously and tied to the link by ff_redeem_watch_link, and from then on
 * reads the league like a manager and writes nothing (see
 * supabase/migrations/20261030140000_watch_links.sql — the database is what
 * enforces that, not anything here).
 *
 * The link is checked before anybody is signed in, so a dead or mistyped one
 * does not leave an anonymous user behind. A malformed token is turned away
 * without asking the database at all.
 *
 * A manager who taps a link is already somebody; he goes to his own table and
 * keeps his seat rather than being turned into a spectator.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/watch/[token]">) {
  const { token } = await ctx.params;
  const origin = request.nextUrl.origin;
  const refuse = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
  const dead = "This link has expired or been switched off. Ask the commissioner for a new one.";

  if (!TOKEN.test(token)) return refuse(dead);

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (user && !user.is_anonymous) return NextResponse.redirect(`${origin}/`);

  const { data: live } = await supabase.rpc("ff_watch_link_live", { p_token: token });
  if (!live) return refuse(dead);

  if (!user) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) return refuse("View-only links aren't switched on for this league yet.");
  }

  const { error } = await supabase.rpc("ff_redeem_watch_link", { p_token: token });
  if (error) {
    await supabase.auth.signOut();
    return refuse(error.message);
  }

  return NextResponse.redirect(`${origin}/`);
}
