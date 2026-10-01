import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "line",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },

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
