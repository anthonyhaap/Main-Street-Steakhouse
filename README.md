# Main Street Steakhouse League

Private 12-manager fantasy football league. Next.js 16 + Supabase (Postgres,
Realtime, Auth), deployed on Vercel.

The league clubhouse now includes private league chat and head-to-head social
challenges. Accepted challenge terms are immutable and audited. Optional dollar
amounts use an external settlement assistant: both managers opt in, the loser
pays separately, and both sides confirm completion. The app never stores payment
credentials, holds funds, initiates transfers, or automatically debits Venmo.

Weekly-matchup challenges resolve automatically from official fantasy scores.
Custom challenges use commissioner verification. Settlement deadlines, payment
references, receipt confirmation, and disputes remain in the audit trail.

## How it's put together

The **database is the application**. All business logic lives in Postgres as
`ff_*` SECURITY DEFINER functions; RLS grants `authenticated` SELECT only, and
there are no write policies anywhere. The web app never writes a row directly —
it calls RPCs. That means a browser with the publishable key cannot corrupt a
draft even if someone reverse-engineers the client.

Scheduled `pg_cron` jobs do the work nobody is watching:

| job            | schedule    | does                                                    |
|----------------|-------------|---------------------------------------------------------|
| `draft-tick`   | every 5s    | `ff_tick_drafts()` — autopicks when a clock expires      |
| `live-stats`   | every 2 min | `ff_poll_live()` — pulls Sleeper stats during game windows |
| `wire-refresh` | every 15 min| `ff_refresh_wire()` — ESPN news and the league injury report |
| `projections`  | every 6 h   | `ff_refresh_projections()` — Sleeper's weekly projections |
| `player-pool`  | daily 08:40 | `ff_load_sleeper_players()` — bio, depth chart, injury designation |
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

### My Team

`/team` is a desk, not a list. One RPC — `ff_team_hub(team_id, week)` — returns
the roster with each player's season form, per-game usage rates, depth-chart
position and this week's real NFL game, plus the team's record, league rank,
matchup and per-position splits. Historical stat lines are re-scored with *this*
league's rules, so a 2025 game log reads as what it would have been worth to us.

Beside the lineup sits the wire. ESPN's public news and league-wide injury
feeds are loaded into `nfl_news` and `nfl_injuries` by `pg_cron`, which means
the app reads them as ordinary tables under the same live contract as
everything else — and an injury row carries the `players.id` it refers to, so
"is one of my guys hurt" is a foreign key rather than a string match. Club
crests and player headshots are hotlinked from ESPN's CDN by ids we already
hold (`player_id_map`), with a monogram fallback — no image pipeline, no
storage.

The two are joined by `src/lib/nfl/insights.ts`, which is the point of the page:
a national injury report is noise until it is read against your roster. The back
ahead of yours is out, so his carries are yours; the quarterback throwing to your
receiver is out, so that is a downgrade; your own starter is questionable, so act
on it. Pure function, roster in and ranked notes out.

### Players

Every name in the app is a `PlayerBadge`: a headshot on the club's colour with
the crest in the corner, linking to `/player/[id]`. `ff_player_card` assembles
that page in one call — bio, club, injury and expected return, this season and
last (both scored under our rules), the projected week and rest of season, the
club's own depth chart, and the wire filtered to him.

Three feeds keep it current, all free and keyless:

| source | gives |
|--------|-------|
| Sleeper `/players/nfl` | age, height, weight, college, jersey, experience, **depth chart**, injury designation |
| Sleeper `/projections/nfl/…` | **weekly projections**, in the same stat shape as the actuals |
| ESPN news + injuries | headlines with photographs, and the league-wide report |

Because projections arrive in the same shape as real stat lines, `ff_score`
prices them with this league's rules: the number on the card is what the
projection is worth *here*, not somebody else's PPR setting.

`/preview/team` and `/preview/player` render both from fixtures — the team desk
from real players with an invented wire, the player card from a verbatim
snapshot of one real response — so either layout can be inspected without a
session.

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
