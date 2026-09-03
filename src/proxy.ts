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
 */
const PUBLIC = ["/login", "/auth", "/join", "/share", "/splash", "/preview", "/manifest.webmanifest"];

export async function proxy(request: NextRequest) {
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

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
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
