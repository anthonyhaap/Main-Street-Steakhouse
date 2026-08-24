# Database schema

Extracted live from Supabase project `ojhjrxolrsppircyrcff` on 2026-08-24 by
reading the running database, because the application source was not available.

Files are numbered in dependency order:

| File | Contents |
| --- | --- |
| `00_extensions_and_types.sql` | extensions, `draft_status` enum |
| `01_tables.sql` | 15 tables with constraints |
| `02_views.sql` | 4 views (`draft_board`, `draft_pool`, `roster_points`, `standings`) |
| `03_functions.sql` | 41 `ff_*` functions — the actual business logic |
| `04_rls.sql` | RLS enablement + 14 SELECT-only policies |
| `05_indexes.sql` | 13 non-constraint indexes |
| `06_cron.sql` | the two active pg_cron jobs |

This is a **reference snapshot, not a migration chain.** It reflects production
as of the extraction date. It has not been replayed against an empty database,
so treat it as documentation to review and diff against, not as a
known-good bootstrap. Applying it to a fresh project would need ordering and
`auth.users` foreign keys sorted out first.

Changes made through the Supabase MCP after this snapshot are recorded as named
migrations in the project itself; list them with `list_migrations`.
