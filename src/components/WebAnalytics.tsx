"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics: page views by route, device, OS and browser. It is
 * cookieless and knows no accounts, so it can answer "what phones does the
 * league use" without knowing who anybody is. The query string is dropped
 * before anything leaves the browser: `/history?manager=Ada` names a person,
 * and the path alone says which page it was.
 */
export function WebAnalytics() {
  return <Analytics beforeSend={(e) => ({ ...e, url: e.url.split("?")[0].split("#")[0] })} />;
}
