# Main Street Steakhouse Fantasy Football

Private 12-manager fantasy football league built with Next.js, Vercel, and Supabase Realtime.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase publishable key (never a secret/service-role key).
3. Run `npm install` and `npm run dev`.

## Production setup

Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to all Vercel environments. Apply `supabase/migrations/202608250001_realtime_and_secure_views.sql` to project `ojhjrxolrsppircyrcff`, then connect this GitHub repository to Vercel with `main` as the production branch.

## Verification

Run `npm run lint` and `npm run build` before deployment.
