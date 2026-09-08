import { NextResponse } from "next/server";
import { APP_ID } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Universal links: the site vouching for the iPhone app.
 *
 * Once Apple's CDN has read this, a league link tapped in Messages or Mail
 * opens the app instead of Safari. The one that matters is the sign-in link:
 * a magic link that opens in Safari leaves the session in Safari, and the app
 * a manager installed to get notifications is still signed out.
 *
 * `/api` is excluded because nothing there is a screen. `/.well-known` is
 * excluded so the file cannot claim itself.
 *
 * Needs APPLE_TEAM_ID — the ten characters on the developer account — because
 * an app id is team-qualified. Empty until it is set, and Apple accepts an
 * empty file as "no app", which is the truth until there is one.
 */
export function GET() {
  const team = (process.env.APPLE_TEAM_ID ?? "").trim();
  const appIDs = /^[A-Z0-9]{10}$/.test(team) ? [`${team}.${APP_ID}`] : [];

  const body = {
    applinks: {
      details: appIDs.length === 0 ? [] : [{
        appIDs,
        components: [
          { "/": "/api/*", exclude: true, comment: "Routes, not screens." },
          { "/": "/.well-known/*", exclude: true, comment: "This file." },
          { "/": "/*", comment: "Every screen in the league." },
        ],
      }],
    },
    webcredentials: { apps: appIDs },
  };

  // Apple reads it as application/json from this path; no .json suffix.
  return NextResponse.json(body, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
