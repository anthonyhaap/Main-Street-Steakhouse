#!/usr/bin/env bash
# =============================================================================
# Replay supabase/migrations/ against an empty database, in order, and stop at
# the first file that fails.
#
# This is the check the README could not make. `check:migrations` proves each
# file matches what production RAN; it cannot prove the directory BUILDS, and
# those are different claims — a set of migrations can each be a faithful copy
# of a statement and still not replay, because the order they were applied in
# by hand is not the order their filenames sort in.
#
# A Supabase preview branch is the real test and it costs a branch and several
# minutes. This is the same test on a local Postgres: a throwaway cluster, the
# platform objects a branch starts with (scripts/replay/preflight.sql), and
# then all 66 files fed to psql with ON_ERROR_STOP.
#
# What it proves: every file parses, every object exists by the time something
# references it, and the directory as a whole produces a schema.
# What it does not: that the schema equals production's. `check:migrations
# --remote` is what covers that, per-file, and the two together are the claim.
#
# Usage:
#   scripts/replay-migrations.sh              # replay, report, tear down
#   scripts/replay-migrations.sh --keep       # leave the cluster up
#   scripts/replay-migrations.sh --summary    # also print an object census
#
# Requires: postgresql-16 server binaries (initdb/pg_ctl) and psql. On Debian
# and Ubuntu that is `postgresql-16`; the GitHub Actions ubuntu runners have it
# preinstalled.
#
# Exit: 0 clean, 1 if any migration failed, 2 if the harness could not start.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
REPLAY="$ROOT/scripts/replay"

KEEP=0
SUMMARY=0
for arg in "$@"; do
  case "$arg" in
    --keep)    KEEP=1 ;;
    --summary) SUMMARY=1 ;;
    *) echo "usage: $0 [--keep] [--summary]" >&2; exit 2 ;;
  esac
done

# The socket directory has to be short: a Unix socket path is capped at 107
# bytes and a sandbox scratch path can spend most of that on its own.
RUNDIR="${REPLAY_RUNDIR:-/tmp/ffreplay.$$}"
PGDATA="$RUNDIR/pgdata"
SOCK="$RUNDIR/sock"
PORT="${REPLAY_PORT:-5433}"
DB=ff_replay

die() { echo "error: $*" >&2; exit 2; }

# ------------------------------------------------------------------ binaries
PGBIN=""
for c in "$(pg_config --bindir 2>/dev/null)" /usr/lib/postgresql/*/bin; do
  [ -x "$c/initdb" ] && PGBIN="$c" && break
done
[ -n "$PGBIN" ] || die "no initdb found. Install the Postgres server package (postgresql-16)."
SHAREDIR="$("$PGBIN/pg_config" --sharedir)"

# Postgres refuses to run as root, so the cluster runs as whatever unprivileged
# account exists. `postgres` is there on any box with the server package.
AS_USER=""
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || die "running as root and no postgres account to drop to."
  AS_USER=postgres
fi
run() { if [ -n "$AS_USER" ]; then su "$AS_USER" -c "$1"; else bash -c "$1"; fi; }

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo
    echo "cluster left running: psql -h $SOCK -p $PORT -U postgres $DB"
    echo "stop it with: $PGBIN/pg_ctl -D $PGDATA stop"
    return
  fi
  run "$PGBIN/pg_ctl -D $PGDATA -m immediate stop" >/dev/null 2>&1
  rm -rf "$RUNDIR"
}
trap cleanup EXIT

# ------------------------------------------------------- the extension shims
# `http` and `pg_cron` are not installable on a stock Postgres — one needs
# libcurl built in, the other a background worker in shared_preload_libraries —
# and `20260809014900_enable_extensions.sql` is the first migration that runs.
# Installing stand-ins lets that file execute VERBATIM, which is the point: the
# alternative is editing the SQL before replaying it, and then the thing under
# test is no longer the thing that ships.
for ext in http pg_cron; do
  [ -f "$SHAREDIR/extension/$ext.control" ] && continue
  cp "$REPLAY/ext/$ext.control" "$REPLAY/ext/$ext"--*.sql "$SHAREDIR/extension/" 2>/dev/null \
    || die "cannot install the $ext shim into $SHAREDIR/extension (need write access; try sudo)."
  echo "installed replay shim: $ext"
done

# ---------------------------------------------------------------- the cluster
# `--keep` leaves a cluster running, and a later run pointed at the same
# REPLAY_RUNDIR used to `rm -rf` its data directory out from under the live
# postmaster. What follows is not a clean failure: initdb rebuilds the
# directory, the old postmaster is still holding the socket, and psql then
# talks to a server whose files have been deleted — so the replay reports
# errors that have nothing to do with the migrations. Stop it first, and
# refuse to delete anything that will not die.
#
# (The port is not the hazard here and does not need to be unique: the server
# is started with `listen_addresses=` empty, so it opens no TCP socket at all
# and the port only names a file inside this run's own socket directory.)
if [ -f "$PGDATA/postmaster.pid" ]; then
  echo "stopping a cluster left behind in $RUNDIR"
  run "$PGBIN/pg_ctl -D $PGDATA -m immediate -w stop" >/dev/null 2>&1 || true
  pid="$(head -1 "$PGDATA/postmaster.pid" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    die "postgres (pid $pid) is still running in $PGDATA and would not stop.
    Stop it by hand before re-running, or point REPLAY_RUNDIR somewhere else."
  fi
fi

rm -rf "$RUNDIR"
mkdir -p "$PGDATA" "$SOCK"
[ -n "$AS_USER" ] && chown -R "$AS_USER" "$RUNDIR"
chmod 755 "$RUNDIR"

run "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8" >/dev/null 2>&1 \
  || die "initdb failed"
run "$PGBIN/pg_ctl -D $PGDATA -o '-k $SOCK -p $PORT -c listen_addresses= -c wal_level=logical' -l $RUNDIR/pg.log -w start" >/dev/null 2>&1 \
  || { cat "$RUNDIR/pg.log" >&2; die "postgres would not start"; }

PSQL=(psql -h "$SOCK" -p "$PORT" -U postgres -X -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null || die "createdb failed"

# pgcrypto lands in `public` on a real branch (core_schema creates it there);
# the preflight needs gen_random_uuid before that runs, and Postgres 16 has it
# built in, so nothing extra is required here.
echo "→ preflight: the objects a Supabase branch starts with"
if ! "${PSQL[@]}" -d "$DB" -f "$REPLAY/preflight.sql" 2>&1 | sed 's/^/    /'; then
  die "preflight failed — the harness is wrong, not the migrations"
fi

# ---------------------------------------------------------------- the replay
mapfile -t FILES < <(find "$MIGRATIONS" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort)
[ "${#FILES[@]}" -gt 0 ] || die "no migrations found in $MIGRATIONS"

echo "→ replaying ${#FILES[@]} migrations against an empty database"
echo

ok=0
failed=""
for f in "${FILES[@]}"; do
  # Each file goes in one transaction, which is how Supabase applies them: a
  # migration that fails half-way must not leave the schema in between.
  out="$("${PSQL[@]}" -d "$DB" --single-transaction -f "$MIGRATIONS/$f" 2>&1)"
  if [ $? -eq 0 ]; then
    ok=$((ok + 1))
    printf '  ok   %s\n' "$f"
    # Record it the way Supabase's runner does, so the replayed database ends
    # up with a history that can be checked against the committed ledger.
    version="${f%%_*}"; name="${f#*_}"; name="${name%.sql}"
    "${PSQL[@]}" -d "$DB" -c \
      "insert into supabase_migrations.schema_migrations (version, name)
       values ('$version', '$name') on conflict (version) do nothing" >/dev/null
  else
    printf '  FAIL %s\n' "$f"
    echo "$out" | sed 's/^/       /'
    failed="$f"
    break
  fi
done

echo
if [ -n "$failed" ]; then
  echo "replay stopped at $failed after $ok of ${#FILES[@]} migrations."
  echo "A Supabase preview branch replays this same directory in this same order,"
  echo "so this is the error that branch reports."
  exit 1
fi

echo "replay clean: ${#FILES[@]}/${#FILES[@]} migrations applied to an empty database."

if [ "$SUMMARY" -eq 1 ]; then
  echo
  "${PSQL[@]}" -d "$DB" -P pager=off -c "
    select 'tables'    as object, count(*) from pg_tables    where schemaname = 'public'
    union all select 'views',     count(*) from pg_views     where schemaname = 'public'
    union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select 'policies',  count(*) from pg_policies  where schemaname = 'public'
    union all select 'cron jobs', count(*) from cron.job
    order by 1;"
fi
