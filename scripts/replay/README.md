# The replay harness

`scripts/replay-migrations.sh` builds a throwaway Postgres, puts the objects a
Supabase branch starts with into it, and feeds it every file in
`supabase/migrations/` in filename order. It answers one question that
`check:migrations` cannot: **does this directory build a database?**

The two checks are different claims and both are needed.

| check | claim |
|-------|-------|
| `npm run check:migrations` | every file names a version production recorded, and its body is what production ran |
| `npm run check:replay` | the directory, replayed in order onto nothing, produces a schema — and the database it produces behaves |

A file can pass the first and fail the second, and that is not a corner case —
it is what happened. Migrations applied by hand over months were applied in the
order someone typed them, with drops and fixups in between that nobody recorded.
Sorted by filename and replayed cold they are a different program.

## What is in here, and why it is not a migration

`preflight.sql` is the platform: the `anon` and `authenticated` roles, the
`auth` and `storage` and `extensions` schemas, `auth.uid()`, the
`supabase_realtime` publication, `supabase_migrations.schema_migrations`.
Supabase creates all of it before the first migration runs. It is deliberately
the smallest set the migrations actually touch — the surface was measured by
grepping the directory, not guessed — because every object invented here is an
object the replay stops being able to prove anything about.

`ext/` holds stand-ins for `http`, `pg_cron` and `pg_net`. None is installable on a
stock Postgres: `http` needs libcurl compiled in, the other two a background worker in
`shared_preload_libraries`. `20260809014900_enable_extensions.sql` is the first
file that runs, so without them there is no replay at all. They are installed
into the Postgres extension directory so that migration executes **verbatim**;
the alternative is rewriting the SQL before testing it, and then the thing under
test is not the thing that ships.

`cron.schedule` records a row and runs nothing. `http_get` returns a null body,
which every loader treats as a failed fetch and raises on — so the replay proves
the loaders compile and are reachable, and deliberately does not pretend the
network answered.

## What a green replay does and does not prove

It proves every file parses, every object exists by the time something
references it, and 66 files in a row produce a schema.

It does not prove that schema equals production's. Nothing here compares the two
databases; `check:migrations --remote` is what covers that, per file. The two
together are the claim, and neither is the claim alone.

## Running it

```
npm run check:replay                   # replay, run the tests, tear down
scripts/replay-migrations.sh --keep    # leave the cluster up to poke at
scripts/replay-migrations.sh --summary # print an object census at the end
scripts/replay-migrations.sh --test    # run supabase/tests/*.sql after the replay
```

`--test` runs every file in `supabase/tests/` against the replayed database,
which is the only honest place to run a behavioural test: it has the schema the
migrations actually build, not the one production drifted into. Each test file
opens and rolls back its own transaction, so they run in any order and leave
nothing behind. A failing file fails the run.

Needs the Postgres **server** binaries (`initdb`, `pg_ctl`), not just `psql` —
`postgresql-17` on Debian and Ubuntu, to match production. It writes the shims
into the extension directory, so it wants root or sudo on a machine where that
directory is not writable.

Set `REPLAY_PG_MAJOR=17` to insist on that version; unset, it uses the first
`initdb` it finds. CI sets it, because the major version changes what Postgres
refuses. Postgres 18, for one, will not UPDATE a published table whose
`replica identity full` covers a generated column the publication does not
send (`challenges.terms_hash`), and 16 and 17 will. A replay on a different
major than production passes or fails on rules production does not have.
