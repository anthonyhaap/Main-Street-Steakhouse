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
| `projections`  | every 6 h   | `ff_refresh_projections()` — this week and next, then rebuild season totals |
| `projections-season` | daily 09:10 | `ff_load_season_projections()` — every unplayed week of the season |
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

### The draft room

Every row in the pool is a badge with a face, and carries a **season
projection** — all eighteen weeks of Sleeper's numbers summed through
`ff_score`, so it is what the player is worth under *our* rules rather than the
market's. `player_season_projections` holds the totals so the board joins
instead of aggregating eighteen weeks per keystroke; cron rebuilds them.

The board can be ordered by ADP or by projection, and the two disagree in
useful places — a quarterback projecting 345 points can sit at ADP 34 because
our passing rules are stingier than the market's. That gap is the point of
showing both.

**A name opens the card in the room.** Leaving the page mid-draft loses the
clock and your place in the list, so in the draft room a `PlayerBadge` takes an
`onOpen` and a plain click raises `PlayerSheet` over the board instead: the
same `ff_player_card` data and the same projection and season cards as
`/player/[id]`, with Draft and Queue on the footer. A cmd-click or middle
click still opens the full page, and the board's filled cells open the same
card. Borrowed from ESPN's room alongside it: a "show drafted" toggle that
greys out taken players with who took them, a roster tab laid out slot by slot
the way the lineup will seed, and "your pick in N" on the clock.

`/preview/team`, `/preview/player` and `/preview/draft` render these from fixtures — the team desk
from real players with an invented wire, the player card from a verbatim
snapshot of one real response, the draft pool from ten real rows — so any of
them can be inspected without a session.

### The season

**Standings carry playoff odds.** `ff_playoff_outlook` returns the table, the
whole schedule with a played flag per matchup, and each lineup's projected
points per game (the starters' remaining season projections, spread over the
weeks left). `src/lib/playoffs.ts` then plays the rest of the season out 4,000
times in the browser: each team's weekly score is normal around a blend of what
it has scored and what its lineup projects, with the projection worth about
four games of evidence. The top *N* by wins-then-points are in. Clinches and
eliminations are worked out exactly, not read off the simulation, so a
"Clinched" badge is a mathematical claim and ">99%" is not.

**The commissioner edits rules all year.** `/admin` has the league rules
(season length, playoff teams and byes, trade deadline, waivers, keepers,
roster slots) and every scoring value. Scoring changes are versioned by
effective week through `ff_set_scoring_rules`; `roster_points` already prices
each week with the rules in force for it, and `ff_rescore_weeks` rewrites the
matchup totals on the spot so the standings agree immediately rather than after
the next cron run.

**Managers have names.** `teams.manager_name` is what the league sees under a
team everywhere; the email is only shown on the invite row in `/admin`.

`/preview/standings` and `/preview/admin` render the standings board and the
rule editors from fixtures.

## Setup

1. `npm install && npm run dev`
2. Optional env (defaults are baked into `src/lib/config.ts`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Migrations in `supabase/migrations/` are already applied to project
   `ojhjrxolrsppircyrcff`.

Release verification: `npm run build` and `npm run test:e2e`.

## Draft-day runbook

1. **/admin → Claim commissioner.** Nothing else works until someone owns the league.
2. Enter each team's name, the manager's name and their email. Each manager
   signs in with that email; `ff_link_me` binds their account to their team
   automatically. The name is what the league sees; the email stays on `/admin`.
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
pushes forward, it never replays what it cannot see. A recorded version with no
file is harmless. **A file whose version is not recorded is the dangerous
direction**, because that is the one the integration would run.

So the invariant is one-way, and CI enforces it. `npm run check:migrations` —
run on every pull request touching `supabase/migrations/` by
`.github/workflows/migrations.yml` — checks each filename against
`supabase/applied_versions.txt`, the committed ledger of recorded versions. It
takes no database credentials and has no dependencies, so nothing can break it
but the thing it is looking for.

It rejects a file whose version is not recorded, a filename whose name half
disagrees with the recorded one, a repeated version, and anything not shaped
like a migration. It warns, without failing, when two files share a name —
legal (`20260829020645` and `20260829021500` are both `team_hub`) but also what
a migration checked in twice looks like.

**How much it proves depends on whether CI can reach the database.** Set a
`SUPABASE_DB_URL` repository secret and the workflow reads the real history and
passes it in with `--remote`; the database then wins over the ledger, so a
stale ledger cannot fail a legitimate file and an invented one cannot pass a
bogus version. Without the secret the check still runs, but it compares the
migrations directory against a ledger sitting beside it in the same pull
request — which a single consistent mistake satisfies: pick a timestamp, name
the file with it, write the same timestamp into the ledger, and the two agree
while the database has never heard of it. The output says which mode ran.
The offline floor is kept deliberately, because a gate that needs a credential
stops working the day the credential expires.

Neither mode compares **contents**. A file correctly named for a recorded
version whose body is something else passes either way; catching that means
hashing against `schema_migrations.statements`, which is a bigger check than
this one.

#### Turning on the database-verified mode

The credential does not have to be the `postgres` superuser, and should not be:
that is full production access sitting in a CI secret to run one `select`
against one table. `20260902020943_ci_migrations_reader.sql` creates a role
that can do exactly that and nothing else — no superuser, no `BYPASSRLS`, no
role memberships, a connection limit of four, and a single `SELECT` grant on
`supabase_migrations.schema_migrations`.

**It is created without a password, so it cannot authenticate.** The role
existing grants nobody anything; it only becomes usable when someone sets one.
To finish:

1. Set a password for it (Supabase SQL editor):
   `alter role ci_migrations_reader with password '…';`
2. Add a `SUPABASE_DB_URL` repository secret under Settings → Secrets and
   variables → Actions, using the **session pooler** host:
   `postgresql://ci_migrations_reader.ojhjrxolrsppircyrcff:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres`

Use the pooler rather than `db.<ref>.supabase.co`: the direct host is IPv6-only
and GitHub's hosted runners have no IPv6, so a direct string works from a
laptop and hangs in CI.

You can tell the stronger mode is live from the check's own output — it logs
`rows: 54` and says *recorded in the database* instead of *recorded in the
ledger*, and drops the note about configuring the secret. To undo the role
entirely: `drop owned by ci_migrations_reader; drop role ci_migrations_reader;`

**When adding a migration**, apply it first, name the file after the version the
database recorded for it — not a timestamp you picked — and add that version to
the ledger (the refresh query is in its header). The two differ because
`apply_migration` stamps its own. Getting this backwards is what left
`20260902010000` and `20260902011500` on disk against `20260902005227` and
`20260902005322` recorded, and days later checked a whole migration in a second
time as `20260902120000`, which would have re-run a `drop function` against
production. Both are now CI failures rather than things somebody has to notice.

Two files carry content from a version adjacent to their name, both deliberate
and both no-ops:

| file | note |
|------|------|
| `20260827034158_league_pulse_automation_health.sql` | four comment lines the applied version lacks; the code is byte-identical to the live `ff_league_pulse` |
| `20260829021956_team_hub_documented.sql` | byte-exact for this version; it was previously misfiled under `20260829021500`, an empty recorded marker |

Never edit a file that has been applied — replace it with a new migration.
