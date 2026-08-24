# Main-Street-Steakhouse

Private 12-team fantasy football league — Next.js 16 on Vercel, Supabase for
Postgres and Auth.

- **[RUNBOOK.md](RUNBOOK.md)** — where everything lives, what has broken before
  and why, and how to verify a login actually worked. Start here.
- **[supabase/schema/](supabase/schema/)** — the database schema, extracted live
  from production. The business logic is 41 Postgres functions, not app code.

> ⚠️ The Next.js application source is **not yet in this repository**. It was
> deployed directly from the Vercel CLI and never committed. See RUNBOOK.md.
