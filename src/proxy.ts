import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";

/**
 * Screens that work without a session.
 *
 * `/share` is the odd one: a matchup card posted into the group chat has to
 * unfurl for whoever taps it, and the messaging app's crawler has no cookie.
 * The page behind it reads through `ff_share_card`, which is the only thing
 * in the league that anon may call, and returns nothing but two names and two
 * scores for an id nobody can guess.
 *
 * `/preview` is the fixture harnesses: invented leagues rendered through the
 * real components, reading nothing from the database. Public so the design
 * can be looked at and tested without a seat at the table.
 *
 * `/api/push/drain` is Vercel Cron, which arrives with no cookie and could
 * not obtain one. It is not unauthenticated — it checks a bearer CRON_SECRET
 * itself and refuses everything if that variable is unset — but the check has
 * to be its own rather than a session, so it cannot be gated here.
 *
 * `/sw.js` must be served at the root for a service worker to claim the whole
 * scope, and the browser fetches it without credentials.
 */
const PUBLIC = ["/login", "/auth", "/join", "/share", "/splash", "/preview",
                "/manifest.webmanifest", "/sw.js", "/api/push/drain"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));
  // `/login` is on the list but still has to know who is asking, because a
  // signed-in manager who lands on it is sent back to the table.
  const isLogin = path === "/login" || path.startsWith("/login/");

  // Everything else on the list needs no session at all — and `getUser()` is a
  // network round trip to the auth server, not a cookie read. Paying it here
  // was paying it on every service-worker fetch, every preview screen, every
  // splash image and every cron POST, to learn something none of them use.
  if (isPublic && !isLogin) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes the auth token on every request so a manager who leaves the draft
  // room open for four hours is still signed in when they come back to it.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    // The whole address goes through the door, query included: `/team?id=x`
    // is somebody else's desk, and `/team` on its own is the reader's. The
    // original query is cleared first so it rides inside `next` rather than
    // beside it.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|woff2?)$).*)"],
};
