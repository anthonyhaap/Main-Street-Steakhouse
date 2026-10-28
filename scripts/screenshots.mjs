#!/usr/bin/env node
/**
 * The two phone captures the manifest lists as screenshots, taken from the
 * public fixtures so they need no session. Run against a server you started:
 *
 *   npx next build && npx next start &
 *   node scripts/screenshots.mjs [http://localhost:3000]
 *
 * 390×844 at 2×, which is the iPhone the e2e suite uses and what Android's
 * install sheet expects of a "narrow" screenshot.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const exe = process.env.PLAYWRIGHT_CHROMIUM ?? undefined;
const shots = [
  ["/preview/tonight", "tonight"],
  ["/preview/matchups", "matchups"],
];

mkdirSync("public/screenshots", { recursive: true });
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const [path, name] of shots) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  // The fixtures wear a banner and a switch at the top; the capture is the app under them.
  await page.evaluate(() => {
    // The banner is whichever block starts with the word, wherever it sits:
    // the outermost element that begins "Fixture." and holds no real screen.
    const starts = (el) => /^\s*(Fixture\.|Preview:)/.test(el.textContent ?? "");
    const cands = Array.from(document.querySelectorAll("body *"))
      .filter((el) => starts(el) && !el.querySelector("main, header, nav, h1"));
    cands.find((el) => !cands.includes(el.parentElement))?.remove();
    for (const el of Array.from(document.querySelectorAll(".segmented"))) {
      if (/Tuesday|Before the draft/i.test(el.textContent ?? "")) el.remove();
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `public/screenshots/${name}.png`, fullPage: false });
  console.log(`public/screenshots/${name}.png`);
}
await browser.close();
