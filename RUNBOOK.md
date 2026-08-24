# Main Street Steakhouse — Fantasy Football

Private 12-team league. Next.js 16 on Vercel, Postgres + Auth on Supabase.

> **Read this first if something is broken.** Most of what has gone wrong so far
> was configuration, not code, and the fixes are all in dashboards.

## Where things live

| Piece | Where | ID |
| --- | --- | --- |
| App | Vercel project `main-street-steakhouse` | `prj_aAicLAVVYGoCMs7SQP4uZYOqbiNb` |
| Live URL | https://main-street-steakhouse.vercel.app | |
| Database + Auth | Supabase project in org **anthonyhaap's Org** (Pro) | `ojhjrxolrsppircyrcff` |
| Vercel team | anthonyhaap's projects (Pro) | `team_BUJDpQv3Pgy9u4ubKTTZc3Hu` |

### Dead ends — do not use these

- Supabase project `xmnxmulktpzrzepnyhox` ("Main-Street-Steakhouse", org "Fantasy
  Football", **free** plan). Empty in every table. It auto-paused on the free
  tier, which is what caused the original "Failed to fetch" on the login page.
  Production pointed here until 2026-08-24.
- Branches `claude/fantasy-football-league-platform-g0guae` and
  `copilot/add-live-tracking-and-score-module`. Older, different stack, not what
  is deployed.

## ⚠️ The application source is not in this repository

The running app was deployed straight from a machine via the Vercel CLI and was
never committed. Vercel holds 28 source files for the deployment; git does not.

**Consequence: a bug in the app cannot be fixed by anyone, because nobody has
the code.** Everything fixed so far was a dashboard setting, which is the only
reason it was fixable.

To recover it: open the deployment in Vercel → **Source** tab → download → commit.
(`GET /v6/deployments/{id}/files` does the same via API and needs a Vercel token.)

The database half *is* under version control — see `supabase/schema/`.

## Architecture note: the logic is in the database

The business logic lives in Postgres as 41 `ff_*` functions, not in the Next.js
app. RLS is **SELECT-only for `authenticated`** with no INSERT/UPDATE/DELETE
policies anywhere, so every write must go through a `SECURITY DEFINER` function.
That is deliberate. Do not add write policies to "fix" a permissions error
without understanding the function layer.

Two pg_cron jobs are load-bearing:

- `draft-tick` — every 5 seconds — `ff_tick_drafts()` advances the draft clock
  and autopicks on expiry. **If this stops, drafts stall on the clock.**
- `live-stats` — every 2 minutes — `ff_poll_live()` pulls live NFL stats over
  the `http` extension and rescores.

## Security: the fail-open pattern

Authorization inside the `ff_*` functions is written as:

```sql
if auth.uid() is null then return; end if;        -- ff_assert_commissioner
if auth.uid() is not null and not exists (...) then raise exception
```

**Signed in → checked. Signed out → waved through.** Combined with `EXECUTE`
granted to `anon` (whose key ships publicly in the browser bundle), this let
anyone on the internet run `ff_make_pick`, `ff_set_lineup`, `ff_start_draft`,
`ff_undo_last_pick` and more.

Closed 2026-08-24 by revoking `EXECUTE` from `PUBLIC` (migration
`revoke_public_execute_on_public_functions`). Note the first attempt revoking
from `anon` alone did nothing — Postgres grants EXECUTE to `PUBLIC` by default
and `anon` inherited it that way. Verify with:

```sql
select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
-- expect 0
```

**Still open:** the fail-open pattern itself is unchanged in the function bodies.
`auth.uid()` is also null when called with the service-role key, so any
server-side route calling these on a user's behalf still skips the checks. Audit
once the app source is recovered.

## Gotchas that have already cost time

**Framework preset.** The Vercel project had no framework set, so it looked for
a static `public/` directory and failed with *"No Output Directory named public"*.
CLI deploys pass the framework at deploy time and mask this; a dashboard
**Redeploy** uses project settings and exposes it. Now set to `nextjs`.

**`NEXT_PUBLIC_*` is baked in at build time.** Changing an env var in the
dashboard does nothing until you redeploy. The old value is already compiled into
the JavaScript being served.

**A committed `.env` file.** The build logs warn `Detected .env file`. It can
shadow the dashboard env vars. Clean this up once the source is recovered.

**Email.** Supabase's built-in sender allows roughly two messages per hour and
is testing-only — it will not serve a 12-person league. Configure custom SMTP
under Project Settings → Authentication. A service with single-sender
verification (SendGrid, Brevo) needs no domain; Resend needs a verified domain.

**Auth URL Configuration.** Site URL must be `https://main-street-steakhouse.vercel.app`
and Redirect URLs must include `/auth/callback`, or the emailed magic link points
at localhost. Symptom: an auth code is issued but no session is ever created.

## Verifying a login actually worked

`auth.audit_log_entries` stays empty on this project, so use flow state instead:

```sql
select created_at, auth_code_issued_at, authentication_method
from auth.flow_state order by created_at desc limit 5;

select count(*) as sessions, max(created_at) from auth.sessions;
```

- row created, `auth_code_issued_at` null → email requested, link never clicked
  (or never delivered)
- `auth_code_issued_at` set but no new session → link clicked but the callback
  failed to exchange the code; check Redirect URLs first
- new row in `auth.sessions` → fully signed in
