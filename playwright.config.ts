import fs from "node:fs";
import path from "node:path";
import { chromium, defineConfig, devices } from "@playwright/test";

/**
 * The Chromium to drive when the environment brought its own and it is not the
 * build this Playwright pins.
 *
 * Agent containers ship browsers pre-baked — `PLAYWRIGHT_BROWSERS_PATH` points
 * at them and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` stops npm fetching more — and
 * the image is baked against whatever Playwright was current when it was built.
 * Bump `@playwright/test` past that and the two disagree: 1.62 wants Chromium
 * revision 1234, the image has 1194, and every single test fails at launch with
 * "Executable doesn't exist" and an invitation to run `playwright install`,
 * which is exactly what the image is configured to prevent. A fresh checkout
 * could not run the suite at all.
 *
 * So when the browser Playwright is going to reach for is not on disk, this
 * finds one that is and drives that instead. The suite is a set of claims about
 * layout, routing and the DOM, and any recent Chromium answers those; a build
 * or two of skew is the cost of the tests running, which beats not running.
 * Newest revision first, so a stale directory left in an image never wins over
 * a fresher one beside it.
 *
 * It no-ops wherever the browsers are right, which is everywhere else: on a
 * developer's machine and on CI, `executablePath()` exists and this returns
 * before looking at anything. Nothing here pins a path, a revision or a
 * container — it reads what Playwright itself intends, and only acts when that
 * intention cannot be satisfied.
 *
 * What it checks is the Chromium build Playwright names, which is not quite the
 * binary it launches: headless runs use a separate `chrome-headless-shell`, and
 * there is no public API that gives its path. So an installation holding one of
 * the pair and not the other still fails at launch, with Playwright's own
 * message. That is left alone deliberately — `playwright install` and the images
 * built with it lay down both, and guessing the shell's path means hardcoding a
 * layout that has already changed once between the two revisions in hand
 * (`chrome-linux` became `chrome-linux64`). A check that silently stops matching
 * is worse than one whose limit is written down.
 */
function substituteChromium(): string | undefined {
  let intended: string;
  try {
    intended = chromium.executablePath();
  } catch {
    return undefined;
  }
  if (!intended || fs.existsSync(intended)) return undefined;

  // "0" is Playwright's own way of saying "keep browsers next to the package".
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || root === "0") return undefined;

  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return undefined;
  }

  const byRevisionDesc = entries
    .filter((e) => /^chromium-\d+$/.test(e))
    .sort((a, b) => Number(b.slice("chromium-".length)) - Number(a.slice("chromium-".length)));

  for (const dir of byRevisionDesc) {
    // `chrome-linux` up to revision ~1200, `chrome-linux64` after it.
    for (const inner of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
      const exe = path.join(root, dir, inner);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const substitute = substituteChromium();
// Said out loud, because testing against a different browser build than the one
// pinned is a fact about the result: a silent substitution is how somebody
// spends an afternoon on a failure the version skew would have explained.
//
// Once, though. This file is re-evaluated in every worker process, and the
// warning repeated per worker lands in the middle of the reporter's output —
// three copies of a notice is how a notice gets ignored. `TEST_WORKER_INDEX` is
// set only in workers, so this is the run's own process talking.
if (substitute && process.env.TEST_WORKER_INDEX === undefined) {
  console.warn(
    `[playwright] ${chromium.executablePath()} is missing; using ${substitute} instead.`,
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    ...(substitute ? { launchOptions: { executablePath: substitute } } : {}),
  },

  /**
   * The suite builds and serves the app itself.
   *
   * It used to declare no server at all, which meant `npx playwright test` ran
   * against whatever happened to answer on :3000 — and against nothing at all
   * if you had forgotten, which is a wall of failures that say nothing about the
   * code. Worse was remembering to start one and forgetting to restart it: a
   * `next start` left over from an earlier build serves HTML pointing at CSS
   * chunks the rebuild has already replaced, every page loads unstyled, and
   * every assertion about layout or a computed style fails. That reads exactly
   * like a regression you did not write, and it cost more than one afternoon.
   *
   * Both of those were a step a person had to remember, so neither is one now.
   *
   * `build` is in the command rather than assumed, so the server can never be
   * older than the tree being tested — the two cannot disagree if the same line
   * produces both. It is cheap: a warm `.next` rebuilds in about eight seconds,
   * and a cold one is the build you owed anyway.
   *
   * `reuseExistingServer` is off everywhere, including locally. Reusing is
   * precisely the stale-server trap above wearing a friendlier name, and the
   * eight seconds it saves are not worth an afternoon. A dev server already on
   * :3000 now fails the run loudly instead of quietly answering it: that one is
   * `next dev`, and these tests are a claim about the production build.
   *
   * The timeout covers a cold build on a slow runner, not a hang — a build that
   * has not finished in three minutes has not finished.
   */
  webServer: {
    command: "npx next build && npx next start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 180_000,
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
