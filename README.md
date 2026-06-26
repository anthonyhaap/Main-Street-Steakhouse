# 🏈 Gridiron League

An **invite-only fantasy football league platform**. A commissioner creates a
league, emails owners a secure invite link, and each owner accepts to create
their account and claim a team. Members only ever see the leagues they belong to
— enforced in the database with Supabase Row Level Security.

> This is the **invite & login foundation**. Draft rooms, scoring, waivers, and
> trades are intentionally deferred — the access model is built first so
> everything later inherits it.

## Tech stack

- **Next.js** (App Router) + **TypeScript**
- **Tailwind CSS**
- **Supabase** — Auth, Postgres, and Row Level Security
- **Resend** for invite emails (optional in dev)
- Deploys to **Vercel**

## Pages

| Route | Page | Who |
| --- | --- | --- |
| `/login` | Login | anyone |
| `/signup` | Sign up (commissioner) | anyone |
| `/accept-invite?token=…` | Accept invite | invited email |
| `/dashboard` | Your leagues | members |
| `/leagues/new` | Create league | members |
| `/leagues/[id]` | League dashboard | league members |
| `/leagues/[id]/my-team` | My Team | league members |
| `/leagues/[id]/members` | Manage members | league members (edit = commissioner) |
| `/leagues/[id]/teams` | Assign teams | commissioner |
| `/leagues/[id]/invite` | Invite owners | commissioner |

## Data model

`profiles` · `leagues` · `league_members` · `fantasy_teams` · `league_invites`

- **profiles** — public identity (`username` is the fantasy handle); email lives
  in `auth.users` and is the login identity.
- **leagues** — owned by a `commissioner_id`.
- **fantasy_teams** — team slots; `owner_id` is null until claimed.
- **league_members** — `(league_id, user_id, role)` where role is
  `commissioner | owner | viewer`.
- **league_invites** — tokenized, expiring invite with `pending | accepted |
  expired | revoked` status.

Full schema and RLS policies: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

### Access rules (enforced by RLS)

- Users only see leagues where they have a `league_members` row.
- Commissioners can invite/remove owners, assign teams, and edit settings.
- Team owners can manage only their own team.
- Viewers are read-only.
- `SECURITY DEFINER` helper functions (`is_league_member`,
  `is_league_commissioner`) keep membership checks from recursing.

## Invite flow

1. Commissioner enters an owner's **email** and optional **team**.
2. App creates a `league_invites` row: secure token, `pending` status, 7-day
   expiry, `league_id`, `email`, `role`, optional `team_id`.
3. App emails an **accept link** (no password is ever emailed).
4. Owner opens the link → token is validated server-side.
5. Owner creates an account (chooses **username** + password) or logs in.
6. App creates the `profiles` row, the `league_members` row, assigns the
   `fantasy_team`, and marks the invite **accepted**.
7. Owner lands on the league dashboard.

Token validation and provisioning run server-side with the service-role key in
[`src/lib/actions/invites.ts`](src/lib/actions/invites.ts) — the only place RLS
is bypassed, and only after the token is verified.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase keys
```

Apply the database schema to your Supabase project — either paste
`supabase/migrations/0001_init.sql` into the SQL editor, or use the CLI:

```bash
supabase db push   # with the Supabase CLI linked to your project
```

Then:

```bash
npm run dev
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (client; RLS-guarded) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Used for token-verified invite provisioning |
| `NEXT_PUBLIC_SITE_URL` | Base URL used to build accept links |
| `RESEND_API_KEY` | Send invite emails. If unset, the accept link is logged to the server console |
| `EMAIL_FROM` | From-address for invite emails |

> **Supabase Auth setting:** invited emails are pre-verified by the invite token,
> and accounts are created with `email_confirm: true` server-side, so the flow
> works whether or not "Confirm email" is enabled.

## Project layout

```
src/
  app/
    login/ signup/ accept-invite/ dashboard/
    leagues/new/
    leagues/[id]/            overview
    leagues/[id]/my-team/    members/  teams/  invite/
  components/                Navbar, LeagueNav, SubmitButton, …
  lib/
    supabase/                client / server / admin / middleware
    actions/                 auth · leagues · invites · teams
    data.ts                  access-checked loaders
    email.ts                 Resend invite email
supabase/migrations/0001_init.sql
```
