# Main Street Steakhouse League

Private 12-manager fantasy football league. Next.js 16 + Supabase (Postgres,
Realtime, Auth), deployed on Vercel.

The league clubhouse now includes private league chat and head-to-head social
challenges. Accepted challenge terms are immutable and audited. Stakes are
descriptive only: the app does not custody funds or automatically debit Venmo.

## How it's put together

The **database is the application**. All business logic lives in Postgres as
`ff_*` SECURITY DEFINER functions; RLS grants `authenticated` SELECT only, and
there are no write policies anywhere. The web app never writes a row directly —
it calls RPCs. That means a browser with the publishable key cannot corrupt a
draft even if someone reverse-engineers the client.

Two `pg_cron` jobs do the work nobody is watching:

| job            | schedule    | does                                                    |
|----------------|-------------|---------------------------------------------------------|
| `draft-tick`   | every 5s    | `ff_tick_drafts()` — autopicks when a clock expires      |
| `live-stats`   | every 2 min | `ff_poll_live()` — pulls Sleeper stats during game windows |
| `stats-settle` | daily 09:17 | `ff_settle_recent_weeks()` — re-pulls for stat corrections |

### Live updates

`src/lib/live.ts` is the contract: *whenever* you open the app you see current
state. It fetches on mount, refetches on realtime change, refetches on
reconnect, and refetches on tab focus with a polling safety net. Postgres change
events are treated only as a signal to refetch, never as the data — which makes
dropped, duplicated, and out-of-order events harmless.

Draft clocks are rendered in **server time**. `useServerClock` measures the
offset against `ff_now()` so a manager with a skewed laptop still sees the true
countdown.

## Setup

1. `npm install && npm run dev`
2. Optional env (defaults are baked into `src/lib/config.ts`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Migrations in `supabase/migrations/` are already applied to project
   `ojhjrxolrsppircyrcff`.

Release verification: `npm run build` and `npm run test:e2e`.

## Draft-day runbook

1. **/admin → Claim commissioner.** Nothing else works until someone owns the league.
2. Enter all 12 manager emails. Each manager signs in with that email; `ff_link_me`
   binds their account to their team automatically.
3. Set rounds + seconds per pick. Randomize draft order.
4. Start the draft from the clock bar in **/draft**.
5. After the board fills: **Seed week 1 rosters**, then **Generate schedule**.

## Draft rehearsal (2026-08-26)

A full 12-team, 15-round mock draft was run on a throwaway league and torn down.
Verified: snake order across round turns, off-clock rejection, duplicate-player
rejection at the DB constraint, pause banks remaining time / resume restores it,
undo rolls the board back and frees the player, cron autopick honours the team's
queue first then falls back to ADP, and the endgame forces required slots
(every team finished with exactly one K and one DST).

Result: 180 picks, 180 distinct players, 180 distinct pick numbers, 15 per team.
Post-draft seeding produced a complete legal lineup for all 12 teams with zero
illegal slot assignments, and the schedule generated 84 matchups over 14 weeks
with no duplicate pairings.

## Auth: no email, on purpose

SMTP was removed from the critical path. The commissioner's list of team emails
is the invite list; a manager sets their own password at `/join`, and
`ff_email_invited` gates it. Nothing is ever sent by mail.

Requires **Confirm email OFF** in Supabase → Authentication → Sign In / Providers
→ Email. With it on, signup tries to send a confirmation and fails.

Because signup is open, reads are gated by `ff_is_member()` rather than by
merely holding a session: a stranger who signs up sees an empty app. Draft
queues are visible only to their owner and the commissioner.

Supabase URL and publishable key are hardcoded in `src/lib/config.ts` — see the
comment there for why env vars were removed.

## Migrations and the GitHub integration

The filenames in `supabase/migrations/` deliberately match the `version` values
already recorded in `supabase_migrations.schema_migrations` on the live project.
Every migration in this directory has ALREADY been applied.

That matters because the repo is connected to Supabase: on push, the integration
applies any migration whose version is not in the remote history. Matching the
recorded versions makes these a no-op instead of a re-run against production.

Migrations from before 2026-08-26 were applied directly and are not checked in;
they exist only in the remote history, which is fine — the integration only
pushes forward, it never replays what it cannot see.

**When adding a new migration**, use a fresh timestamp ahead of
`20260826030518`, and never rename or edit a file that has already been applied.
