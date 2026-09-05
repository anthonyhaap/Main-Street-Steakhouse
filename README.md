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

The web app's request boundary is `src/proxy.ts` (Next 16 renamed middleware
to proxy). Everything is behind the session except `/login`, `/join`, `/auth`,
`/share`, `/splash`, `/preview` and the manifest.

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
hold (`player_id_map`), with a monogram fallback — no image pipeline and
nothing of the NFL's stored here.

The one picture the league does store is a manager's own. **Edit team** in the
hero renames the team and uploads a crest, which then replaces the monogram on
every seal in the app — top bar, standings, scoreboard, draft clock. Two
things keep that safe. `teams.logo_path` holds an object key, never a URL, so
the column can only ever address our own bucket rather than becoming a stored
redirect printed on every screen. And the key IS the authorization: an object
lives at `<team_id>/<file>`, the `team-logos` storage policy lets a manager
write only inside the folder named for the team he owns, and
`ff_update_my_team` takes no team id at all — it edits whatever team the caller
owns, so there is nothing to spoof. The commissioner keeps `ff_update_team` for
draft slots, manager names and any team in the league. Uploads are downscaled
to 512px in the browser before they are sent; an animated GIF is left alone,
because a canvas would keep only its first frame.

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

### Tonight's Table

`/` is no longer a dashboard. It is one card, typeset like a reservation, that
answers the three questions a manager has when the app opens: who am I
playing, am I winning, what do I do now. Everything else on the screen — the
six tables as a swipe carousel, the standings as a place card — is below it.

One RPC feeds it. `ff_briefing(league_id)` returns my matchup with live and
projected totals and each starter's game state, my record and seed, the
all-time head-to-head against tonight's opponent, last week's result, the
week's slate, the lineup's problems, and the state of the NFL calendar. The
page is **server-rendered** from that call on the session cookie, so the HTML
that arrives already says "Week 3 · You vs. Dave"; `useLive` then takes over
with the server payload as its initial state and refetches under the usual
contract. The skeleton has the card's exact silhouette, so nothing shifts.

`src/lib/briefing.ts` turns the facts into words, and is pure:

| function | decides |
|----------|---------|
| `phaseOf` | the personality: `draft`, `preseason`, `lineup`, `waivers` (Wednesday), `recap` (Tuesday), `live`, `monday`, `settled` |
| `headline` | "Week 3 · You vs. Dave", "You beat Mike." |
| `narrative` | the one true line: "You've dropped three straight to Dave. Sunday's the rematch.", "You need 11.4 from McBride. He's projected 12.4." |
| `action` | the one thing to do, never two: fill the empty slot, check on the questionable starter, watch it live, send the recap |
| `recapText` | the Tuesday recap in the house voice, for the group chat |

Under it: the six tables as a swipe carousel, **Overheard** (below), and the
standings as a place card.

The day of the week is the league's (`LEAGUE_TZ`), not the phone's. The NFL
slate decides the rest: any game in progress is Sunday whatever the calendar
says, and a Monday with only your tight end left to play is written as a
number he has to reach. `/preview/tonight` renders every day from one fixture.

Two things the card does on a phone that the old dashboard did not. On the
first visit of a session — the doors below take the place of it on the way in
from sign-in — an ink curtain with a gold monogram etches in and the card's
rules draw before the text fades up — a little over a second, set by an inline
script before first paint so it never flashes, `pointer-events: none` so it
never blocks a tap, and skipped entirely under `prefers-reduced-motion`. And on
a Sunday the projected numbers become live numbers: a score that ticks up
counts rather than snaps, flashes gold when it is yours and goes dim when it is
his, and taps an Android wrist through `navigator.vibrate`.

**It is an app on the phone.** `manifest.ts` declares standalone display,
`/splash/<w>x<h>.png` draws the ink launch screen at whatever size an iPhone
asks for (Satori, no PNGs in the repo), the layout lists them per device, and
`InstallNudge` shows the two taps once on a first mobile visit. The tab bar
carries four items — Tonight, Matchups, My Team, Standings — with everything
else behind More; pull to refresh works in the installed app only, where the
browser's own is absent. Fraunces and Inter arrive through `next/font`, so the
headline has an optical-size axis and every score sits in tabular figures.

### The wall

"Est. 2016" is on the crest, and `/history` is the room that proves it: a
plaque of champions, a 12×12 all-time head-to-head grid painted as a heat map,
rivalries the numbers found on their own, the longest runs and the worst
beatings, and a card for every manager with a title the record earned
("Three-time finalist. Never won.").

`league_history` holds the seasons before this app, keyed by **manager name**
rather than team row, because teams are re-created every year and people are
not. The current season joins in from `matchups` through `teams.manager_name`,
so the wall and the briefing's "all-time against Dave" line are live from week
two of 2026 whether or not the old seasons are in yet. They go in once, from
`/admin`: one CSV line per game, `season,week,round,home_manager,…`, through
`ff_import_history`, which replaces any season it is handed so a corrected
sheet can be pasted again. `ff_history` assembles the wall; `/preview/history`
renders ten invented seasons through it.

### The share card

`/share/matchup/[id]` is the one public page in the league. It reads through
`ff_share_card`, the only function anon may call, which returns two names,
two managers, two scores, the week and the top scorer for a matchup addressed
by an unguessable id — and nothing else. Its `opengraph-image` is drawn per
matchup in ink and gold with Fraunces (`public/fonts/`), so the link unfurls
in the group chat as a card. The recap button on Tuesday's briefing opens the
phone's share sheet with the week's results written in the house voice and
that link at the bottom; where there is no share sheet, it copies.

### The Sunday board

`/matchups` is the screen the league actually watches on a Sunday, and for a
long time it was a schedule: two names, two numbers and a caret. True, and
nearly useless — the numbers a manager watches are the ones that say where a
game is *going*.

One RPC feeds it now. `ff_scoreboard(league_id, week)` returns every table in
the week with both lineups on it: each starter's points, his projection, his
real game's state and kickoff, plus each side's projected total, how much of it
is still to come, how many men are in action, and that side's best day so far.
It also returns when the numbers were last written, which the page prints.

`src/lib/scoreboard.ts` turns those facts into the screen, and is pure:

| function | decides |
|----------|---------|
| `cardState` | `pre`, `live`, `between`, `settled` — the card's personality |
| `projectedFinal` | points plus what is left, counting a man already playing for the part of his projection he has not reached |
| `winOdds` | the live probability: the projected margin over the spread still to come, through a normal CDF |
| `cardLine` | the one sentence — "You need 5.9 from Robinson. He's projected 8.0." |
| `slateLine` | "6 games on now, 2 still to kick." |
| `freshness` | "Scores 1 min ago · projections 5h ago" |

The odds model is deliberately simple and the card says so: each starter still
to play is an independent swing with a standard deviation of 65% of his
projection, floored at five points, halved for a man whose game is already on.
It is not a simulation of the NFL; it is an honest reading of how much can
still change, and it collapses to a certainty when the last game ends. The
split is always printed as two percentages as well as drawn as a bar, so the
card reads the same to someone who cannot separate wine from gold.

Hierarchy is the other half of it: your game is one card at the top, three
times the size, and the other five are a list. Changing week never blanks the
screen — the board you were looking at stays, dimmed, until the next lands.

`/preview/matchups` runs a whole invented Sunday through the real component:
before the draft, nothing kicked, the one o'clock games on, the late window,
and Monday with one man left. `tests/e2e/scoreboard.spec.ts` asserts the
sentences and the odds off that fixture.

### Table talk

`league_messages.matchup_id` had been on the table since the clubhouse was
built and nothing had ever written to it. That column is the whole feature: a
comment belongs to the game it is about, so the argument lives on the
scoreboard card instead of in a room people have to remember to visit.

Every card carries a thread. Closed, it is one line — the count and the last
thing said, both of which `ff_scoreboard` already returns, so a quiet table and
a loud one do not look the same. Opened, `ff_matchup_thread` fetches it with
each author resolved to their team and to which side of the game they sit on,
and `ff_send_matchup_message` posts, behind the same RPC boundary as every
other write. The membership check is the league, not the two managers playing:
heckling somebody else's table is the point.

The thread is not fetched until somebody opens it — six threads polled every
fifteen seconds through a Sunday would be six times the traffic for a screen
nobody is reading. `league_messages` is on the board's realtime watch list, so
a line said about any game lights up its count without a reload.

It reads in both directions. A matchup comment still appears in the clubhouse,
captioned with the game it was said about and linking back to that week's
board — moving the argument onto the scoreboard would be no improvement if it
then vanished from the room everyone reads.

`TalkThread` is pure and `MatchupTalk` is the live one around it, which is what
lets `/preview/matchups` render a real argument from a fixture with no session:
an `onSend` that isn't there is the read-only thread a signed-out reader gets.

**One thing this found.** `ff_scoreboard` had shipped without a grant line, so
it kept Postgres' default of EXECUTE to PUBLIC — which here means `anon`, and
the league id ships inside the client bundle. Every sibling RPC is
authenticated-only. `20260904020439` corrects the grant and, so a future
mistake cannot re-open it, makes the function refuse a caller with no
`auth.uid()` outright rather than leaning on the grant the way its siblings do.

### The room, on the front page

Tonight's Table answers three questions in the first second. The clubhouse is
not one of them — it is the thing that makes a manager open the app a fourth
time on a Tuesday — so **Overheard** sits under the card: the last four lines
said anywhere in the league, and, above them, the thread on your own table with
the last thing said in it.

A line said on a matchup card arrives with the game it was said about and links
to that week's board; a line said in the room carries nothing. The feed is one
call, `ff_clubhouse_feed`, and it is deliberately a *second* call made in the
browser after the card is painted, for three reasons in order of weight: it is
a secondary feed and should arrive after the card, not with it; it refetches on
`league_messages` alone, where folding it into the briefing would re-run the
head-to-head history and the playoff seeding every time somebody typed a
sentence; and restating a four-hundred-line function to add a footnote to it is
how a working function gets broken.

`RoomBoard` is pure and `Room` is the live one around it, so `/preview/tonight`
renders the feed from a fixture. The section is `.club`, not `.room`: the
carousel of six tables already wears that class.

**Two things this found.** The desktop nav had eleven destinations in uppercase
at 0.13em tracking, and after *Scores → Matchups* and *Chat → Clubhouse* it no
longer fit a 1200px laptop — the header scrolled sideways. The items are now
sentence case at normal tracking, which is both a third narrower and the
legibility fix the review asked for, and the breakpoint where the tab bar hands
over moved from 1080px to 1180px. `tests/e2e/tonight.spec.ts` now asserts that
the page never scrolls sideways at either viewport.

### The Weekly Special

The recap existed twice and neither one was a post. `recapText` writes the week
for a share sheet, which needs somebody to press share; Tuesday's briefing tells
*you* what happened to *you*. Neither leaves anything behind for the league to
argue with on Wednesday. So the house writes it, once a week, into the clubhouse.

| function | does |
|----------|------|
| `ff_week_recap` | the facts: every result, the high and the low, the widest margin, the closest game, the week's best player, and the bench decision that cost somebody the game |
| `ff_recap_body` | those facts as prose, in the house voice |
| `ff_publish_recap` | writes the recap and posts it — idempotent on (league, week) |
| `ff_post_weekly_recaps` | the `weekly-recap` cron, daily at 13:00 UTC |

```
The Weekly Special · Week 11

Tom 130.1 — Nate 83.9
Dave 142.6 — Marcus 118.2
Sam 104.2 — Kai 103.4

Tonight's Specials: Dave, 142.6.
Sent back to the kitchen: Nate, 83.9.
The Bill: Tom by 46.2 over Nate.
Last Call: Sam edged Kai by 0.8.
Left on the pass: Priya sat Trey McBride (22.4) and lost by 5.1.
Player of the week: Puka Nacua (LAR), 34.2, for Dave.
```

The bench line is the one with a test in it. Naming the highest-scoring reserve
of the week is trivia; the line only earns its place when sitting him actually
lost the game, so it names a **loser whose best reserve beat their worst starter
by more than the margin of defeat**, and stays silent otherwise.

Two decisions worth knowing. The prose is a separate immutable function from the
facts, so the words can be tested without a played week — which is the only way
this got tested at all, the league having not kicked off yet. And the cron runs
**daily**, not on Tuesdays: the guard decides when a week is actually over, so a
flexed game, a holiday or a missed run still gets its recap the day the week
finishes. `/admin` has the same button for the week the scheduler missed.

**Verified end to end on a throwaway branch**, 2026-09-04. A seeded week 5 —
twelve teams, 168 players, six games — was run through `ff_post_weekly_recaps()`
exactly as the scheduler calls it, and every claim in the posted body was then
recomputed independently and compared:

| claim | check |
|-------|-------|
| six result lines | each matches a real game, ordered by descending margin |
| high / low | equal to the max / min team score of the week |
| The Bill / Last Call | equal to the max / min margin |
| player of the week | the top **starter** (22.8) — not the 26.0 on a bench |
| left on the pass | the only one of twelve teams that qualifies, swing 19.1 against a 5.1 defeat; the manager who lost by 0.9 is correctly passed over |
| idempotency | a second cron run does nothing, a second publish says "already written", an unfinished week says "nothing played"; one recap row, one post |
| `kind` / `author_id` | a house post with an author, a manager post without one, and a third `kind` are all rejected by the check constraints |

The `mine` fix was confirmed to be a real bug and not a theoretical one: against
a house post, `author_id = auth.uid()` evaluates to NULL, and only the
`coalesce(..., false)` turns it into the boolean the browser expects.

**A note if you try this yourself.** `supabase/migrations/` deliberately starts
at 2026-08-26 — the core schema was applied directly and never checked in — so
a fresh Supabase branch cannot build itself from this repo, and comes up with
zero tables. (That is also why the `main` preview branch has sat in
`MIGRATIONS_FAILED` since it was created.) The verification above installed the
slice the recap touches, copied from production via `pg_get_functiondef` and
`pg_get_viewdef`, and confirmed the five recap functions matched production
byte-for-byte once comments were normalised away. The one deliberate
substitution was `ff_score`, stubbed to read `{"pts": n}` so the harness could
set every player's score exactly; the recap never looks at how a player earned
his points, only at which player has the most.

A house post is a message with **no author**: `league_messages.author_id` lost
its NOT NULL and gained a `kind`, with a check constraint that keeps the two in
step (`(kind = 'house') = (author_id is null)`) — a manager's line must still be
signed. The alternative was posting as the commissioner, which is a lie about
who wrote it. It renders in Overheard and in the clubhouse as a column: a gold
rule, the serif, and the line breaks it was composed with.

### Odds that admit what they don't know

The playoff simulation on `/standings` did exactly what it was asked before the
draft — drew twelve identical teams from one distribution and reported that all
of them had about a coin flip's chance, with a projected 7–7 apiece. Every
number correct, and the screen a lie: analytical theatre about a league that
has not happened yet.

`oddsCanSeparate` is the gate. Until a result exists or a drafted roster can be
projected from, the board withholds the odds, drops the columns that would be
zeros, lists the teams alphabetically so the order claims nothing, and says
that odds unlock after the draft. A league that has drafted but not kicked off
still gets its odds, with the note that they lean entirely on projected
lineups. The same rule applies on the Sunday board: no rosters, no odds bar.

`/preview/standings` and `/preview/admin` render the standings board and the
rule editors from fixtures; the standings preview switches between the
preseason state and week 11. The commissioner's old dashboard — readiness
checklist, roll call, automation health — lives on at `/league`.

### What the tabs are called

Two names were doing two jobs each. "Scores" is the week's matchups, and
calling it Scores made it read as a results page rather than the screen you
watch: the tab is **Matchups**. And the room is the **Clubhouse** everywhere in
the app except the tab that opened it, which said Chat; a product with two
names for one place has neither. Commish tools keep their place in the bar and
lose their equality — a rule before them and a crown on them — because sitting
them at the same weight as My Team told eleven managers to read past that whole
end of the bar.

The `/preview` routes are public. They read nothing from the database; every
one is an invented league rendered through the real components, which is what
lets `tests/e2e/tonight.spec.ts` assert the card's sentences without a session.

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

### The doors

Signing in is the one moment the app can afford some theatre, so it takes it.
On the way out of `/login` and `/join` two black doors close over the form,
lean on the latch, and swing open towards you; the house mark is drawn once
across both leaves in brass, so it splits down the seam as they part, and the
light from inside catches their leading edges as they go.

Behind them is a room, not a light box: near black, thick with smoke, cut by
five hard shafts off a lamp at the far end. Haze comes up first, because a beam
is only a beam once there is something in the air for it to land on; the smoke
is nine plumes on nine clocks, screened over the dark so the shafts brighten it
rather than paint over it. You walk at the lamp, it blooms, and the screen
washes white — the page changes under that, and the last of the smoke drifts
off the top as the overlay dissolves.

`DoorsHost` lives in the root layout rather than on the two auth screens
because the whole point is that it outlasts them — a layout is the only thing
in an App Router tree that survives the `router.push` it is covering. The
screens themselves only call `enterThroughDoors(go)`; that hands `go` back
2.6s in, under full white, and takes the overlay off the screen at 3.5s whether
or not the route ever arrived, so nothing can be left sitting on top of the
app. Under `prefers-reduced-motion` it navigates immediately and mounts
nothing. Going through the doors also marks the ink curtain seen for the
session, because the two of them back to back is the same beat played twice.

A phone gets four of the plumes and one of the shafts taken out and the fan
closed up, because a shaft at 38 degrees leaves a 390px frame before it reaches
the floor — and because blur that wide, that many times over, is what costs a
phone its frame rate.

`/logo-full.png` is ink on paper and would be invisible on a black door, so the
crest is redrawn as inline SVG in cream and gold at the logo's own proportions,
its ring cut as the two arcs the wordmark leaves behind. `/preview/doors` plays
the whole thing on demand against a stand-in for the page behind it.

## Migrations and the GitHub integration

The filenames in `supabase/migrations/` deliberately match the `version` values
already recorded in `supabase_migrations.schema_migrations` on the live project.
Every migration in this directory has ALREADY been applied.

That matters because the repo is connected to Supabase: on push, the integration
applies any migration whose version is not in the remote history. Matching the
recorded versions makes these a no-op instead of a re-run against production.

A recorded version with no file is harmless. **A file whose version is not
recorded is the dangerous direction**, because that is the one the integration
would run.

### The history is complete, and branches build

Until 2026-09-04 the directory started at 2026-08-26: everything before it had
been applied by hand and existed only in the remote history. That was tolerable
for production — the integration only pushes forward — and fatal for anything
that has to build the schema from nothing. A fresh Supabase preview branch
replays this directory against an empty database, so it came up with **zero
tables**, which is why the `main` preview branch sat in `MIGRATIONS_FAILED`.

All 29 missing migrations are now checked in, recovered verbatim from
`supabase_migrations.schema_migrations.statements` — the database keeps the SQL
of everything it has run — and each file was verified byte-for-byte against its
recorded statement by md5 before being committed.

One file is different, and deliberately so.
`20260809014900_enable_extensions.sql` is the only migration here whose version
was **chosen rather than assigned**. `http` (the loaders' fetch) and `pg_cron`
(every scheduled job) were enabled by hand before the first migration ever ran,
so they appear nowhere in the history — and a fresh database therefore died at
the first `cron.schedule`. The file is back-dated to sort ahead of
`core_schema`, because a prerequisite that runs after the thing needing it is
not a prerequisite. Its statements are `create extension if not exists`, so on
the live project it is a strict no-op; it was executed there, changed nothing,
and was then recorded so the version and the file agree.

**What was verified, and what was not.** On a throwaway branch, an empty
database was confirmed to lack both extensions, `cron.schedule` was confirmed to
fail on it, and that migration was confirmed to fix both. A complete 66-file
replay was *not* executed — it cannot be driven from the tooling used here — so
the first real proof will be the next preview branch Supabase builds.

**The files were then compared against what actually ran, and two had drifted.**
Only 29 files are byte-identical to their recorded statement. The rest differ,
and almost all of it is nothing: 17 differ only in line endings or a trailing
newline, 5 only in comments, and the rest only because the SQL editor reflowed
the statement onto one line or spelled a dollar-quote `$fn$` instead of `$$`.
Normalize those away and 62 of 66 files say exactly what was run.

Two did not, and both would have made a rebuilt database quietly wrong:

- `20260829120826_player_card` had lost a `nulls last` from the depth-chart
  ordering. `desc` alone sorts nulls *first* in Postgres, so a rebuilt
  `ff_player_card` would have ordered the depth chart differently from the live
  one. Production has the `nulls last`; the file now does too.
- `20260826023254_harden_commissioner_authorization` was missing the two
  `revoke` statements it ends with. The live project has `ff_current_week`
  revoked from `public` and `anon`; a database built from this directory would
  have left it callable by anyone. That is a security migration that had been
  checked in with its security half removed.

Four files still differ for reasons that are argued rather than accidental, and
they are listed in `CONTENT_EXCEPTIONS` in the check script: two where the file
adds something harmless (an idempotent `revoke`, a `comment on function`), and
two applied through the Supabase SQL editor, which recorded no usable
statements at all — `historical_final_standings` recorded the sentence
*"Applied from the checked-in migration through the Supabase SQL editor."*
instead of SQL, and `team_hub_projections` recorded nothing. For those two the
file is the only record of the migration, and the live schema was checked by
hand to confirm it matches.

**This is now checked, not remembered.** See the content check below.

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

**With the database, it also compares contents.** The dump carries each
migration's statements alongside its version and name, and every file is
compared against the SQL that ran under it. This is the failure that hides the
longest: the version is already in the history, so the file never runs against
production and nothing breaks — but a preview branch replays the *file*, and
builds a database that is not a copy of production. It is what had happened to
`player_card` and `harden_commissioner_authorization` above.

The comparison normalizes what a migration legitimately picks up on the way to
being checked in — line endings, statements reflowed onto one line, comments,
`$fn$` versus `$$` — so only a real difference in the SQL fails, and a file that
is the documented version of what ran still passes. Files that differ for a
known reason are listed in `CONTENT_EXCEPTIONS` in the script, each with the
argument for it; they warn instead of failing, so the list stays visible and
short. Offline the bodies are not checked at all, and the output says so.

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
and both no-ops (see also the caveat above: many files are documented rather
than byte-exact copies of what ran):

| file | note |
|------|------|
| `20260827034158_league_pulse_automation_health.sql` | four comment lines the applied version lacks; the code is byte-identical to the live `ff_league_pulse` |
| `20260829021956_team_hub_documented.sql` | byte-exact for this version; it was previously misfiled under `20260829021500`, an empty recorded marker |

Never edit a file that has been applied — replace it with a new migration.
