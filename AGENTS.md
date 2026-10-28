<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# How changes land

**Open a pull request. Do not push to `main`.**

Several agents work this repository at once — four separate changes landed on
`main` during one feature's review, one of them on top of a merge that was
still being discussed. When everybody pushes to the shared branch directly,
each of those becomes a collision somebody else has to untangle, and undoing
one means rewriting history under a session that may still be running. A branch
and a PR cost nothing and keep the collisions in one place.

- Branch from the latest `origin/main`, and name the branch for the change.
- If `main` moves under you, merge it in and run the checks again. Do not
  rebase or force-push a branch anyone else may have pulled — a merge commit
  keeps their checkout valid, a rewrite does not.
- Push the branch and open the PR. `main` should be what came out of a review,
  never what went into one.

## Before you open it

All of these, every time — a change that touches no code needs none of it,
but anything that touches `src/`, `tests/` or `supabase/` needs all five:

| check | command |
|-------|---------|
| build | `npx next build` |
| types | `npx tsc --noEmit` — run the build first; it reads `.next/types` |
| lint | `npx eslint` — compare the count against `main`, which is not zero |
| migrations | `npm run check:migrations` |
| end-to-end | `npx playwright test` |

The lint baseline is not clean. Compare your count to the one on `main` rather
than to zero; the standing findings are not yours to fix on the way past.

**The e2e suite serves itself.** `playwright.config.ts` declares a `webServer`
that runs `next build && next start`, so `npx playwright test` is the whole
command — nothing to start first, and nothing to remember to restart. The
server it tests is built from the tree you are testing, every run.

Two consequences worth knowing before they surprise you:

- **It will not reuse a server already on :3000**, including one of your own.
  That is deliberate: reusing is how a run ends up testing an older build than
  the one on disk, which fails every assertion about layout and reads exactly
  like a regression you did not write. Stop your `next dev` and let the suite
  start its own.
- **A run therefore includes a build.** About eight seconds against a warm
  `.next`, longer from cold — and it is the build you owed anyway.

These four checks also run on every pull request that touches `src/`, `tests/`
or `public/` (`.github/workflows/checks.yml`); migrations have had their own
workflow for longer. CI is the backstop, not the point: a red pull request
after the fact costs a round trip that running them here does not.
