import { NextResponse } from "next/server";
import { APP_ID } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Digital Asset Links: the site vouching for the Android app.
 *
 * A Trusted Web Activity is Chrome rendering this site with no address bar,
 * and Chrome only hides the bar once this file names the app's signing key.
 * Without a match the app still opens — it just looks like a browser tab, and
 * that is the whole difference between an app and a bookmark.
 *
 * The fingerprints are SHA-256 digests of the SIGNING certificate. With Play
 * App Signing that is Google's key, read from the Play Console under App
 * integrity, not the upload key on the laptop — the two are different, and
 * the app on a manager's phone carries Google's. A comma-separated list so a
 * debug build can be vouched for beside it while testing.
 *
 * Empty until ANDROID_CERT_FINGERPRINTS is set: an empty list is a valid file
 * that vouches for nothing, which is better than a 404 Chrome caches as
 * "this site has no app".
 */
export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));

  const statements = fingerprints.length === 0 ? [] : [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: APP_ID,
      sha256_cert_fingerprints: fingerprints,
    },
  }];

  return NextResponse.json(statements, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
