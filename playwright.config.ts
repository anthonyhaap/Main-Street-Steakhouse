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
 * developer's machine and on CI, the pinned build is installed and this returns
 * before looking at anything. Nothing here pins a path, a revision or a
 * container — it reads what Playwright itself intends, and only acts when that
 * intention cannot be satisfied.
 *
 * "Installed" has to mean more than the one path `executablePath()` names,
 * though, because that is the full browser and a headless run launches a
 * separate `chrome-headless-shell`. Either half is enough on its own:
 * `playwright install --only-shell` lays down just the shell, which is a
 * supported installation and exactly what a headless suite wants, while
 * `--no-shell` lays down just the browser. So the check looks for both, and
 * decides between four states rather than two:
 *
 *   shell present            -> nothing to do; Playwright picks it and it works,
 *                               whether or not the full browser is beside it.
 *   only the full browser    -> name it, so a headless launch uses the browser
 *                               instead of hunting a shell nobody installed.
 *   neither, but an older
 *   build is lying around    -> drive that, with a warning. The skewed image.
 *   neither and nothing else -> undefined, and Playwright says so itself.
 *
 * The shell is found by directory rather than by executable: no public API gives
 * its path, and the layout inside these directories has already changed once
 * between the two revisions in hand (`chrome-linux` became `chrome-linux64`).
 * A directory name is the stabler of the two things to guess.
 */
function substituteChromium(): string | undefined {
  let intended: string;
  try {
    intended = chromium.executablePath();
  } catch {
    return undefined;
  }
  if (!intended) return undefined;

  // `<cache>/chromium-1234/chrome-linux64/chrome` -> the build, and the cache it
  // sits in. Taken from the path Playwright gave rather than from
  // PLAYWRIGHT_BROWSERS_PATH, so this reads the right place even when that is
  // unset and the cache is Playwright's own default.
  const build = path.dirname(path.dirname(intended));
  const cache = path.dirname(build);
  const shell = path.join(
    cache,
    path.basename(build).replace(/^chromium-/, "chromium_headless_shell-"),
  );

  // Either half of the pinned revision is enough to leave well alone.
  if (fs.existsSync(shell)) return undefined;
  if (fs.existsSync(intended)) return intended;

  let entries: string[];
  try {
    entries = fs.readdirSync(cache);
  } catch {
    return undefined;
  }

  const byRevisionDesc = entries
    .filter((e) => /^chromium-\d+$/.test(e))
    .sort((a, b) => Number(b.slice("chromium-".length)) - Number(a.slice("chromium-".length)));

  for (const dir of byRevisionDesc) {
    // `chrome-linux` up to revision ~1200, `chrome-linux64` after it.
    for (const inner of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
      const exe = path.join(cache, dir, inner);
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
// Only when the build actually differs, though. Naming the pinned browser
// because its headless shell is missing changes which executable launches and
// not which Chromium is under test, and a warning about skew that is not there
// teaches people to disregard the one that matters.
//
// And once, not once per worker: this file is re-evaluated in every worker
// process, and three copies of a notice interleaved with the reporter's output
// is how a notice gets ignored. `TEST_WORKER_INDEX` is set only in workers, so
// this is the run's own process talking.
const skewed = substitute !== undefined && substitute !== chromium.executablePath();
if (skewed && process.env.TEST_WORKER_INDEX === undefined) {
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
