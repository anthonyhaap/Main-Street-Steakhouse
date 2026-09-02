#!/usr/bin/env node
/**
 * Every file in supabase/migrations/ must name a migration the database has
 * actually recorded.
 *
 * The repo is connected to Supabase: on push, the integration applies any
 * migration whose version is not in the remote history. So the invariant is
 * one-way, and only one direction is dangerous:
 *
 *   a recorded version with no file  — harmless. Most of the early schema is
 *                                      like this; the integration only pushes
 *                                      forward and never replays what it
 *                                      cannot see.
 *   a file with no recorded version  — THIS is the failure. It is indistinguishable
 *                                      from new work, so it runs against
 *                                      production.
 *
 * It went wrong twice in one evening, both times the same way: `apply_migration`
 * stamps its own version, and a file named from a timestamp someone picked
 * instead does not match it. Once as two mis-stamped files, once as a whole
 * migration checked in a second time under a fresh timestamp — which would have
 * re-run a DROP FUNCTION against production.
 *
 * ── how much this proves, and when ──────────────────────────────────────────
 *
 * Offline (no arguments) it compares filenames against supabase/applied_versions.txt,
 * a ledger committed alongside them. That catches both incidents above, because
 * both left the ledger alone. It does NOT catch a consistent mistake: name the
 * file from a timestamp you picked, write that same timestamp into the ledger,
 * and the two agree with each other while the database has never heard of it.
 * The ledger is an assertion, and offline this script can only check the
 * assertion against itself.
 *
 * With `--remote <file>` — lines of "<version> <name>" read out of the live
 * database — the ledger is checked rather than believed, and that hole closes.
 * CI runs this whenever a database URL is configured. Without one the offline
 * floor still holds, which is why the ledger exists at all: a gate that needs a
 * credential is a gate that stops working the day the credential expires.
 *
 * Neither mode compares CONTENTS. A file correctly named for a recorded version
 * whose body is something else passes either way; catching that means hashing
 * against schema_migrations.statements, which is a bigger check than this one.
 *
 * Usage:
 *   node scripts/check-migrations.mjs
 *   node scripts/check-migrations.mjs --remote /tmp/remote.txt
 *
 * Exit: 0 clean, 1 on any error below, 2 on bad usage.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(root, "supabase", "applied_versions.txt");
const DIR = join(root, "supabase", "migrations");

/** `20260902011636_commissioner_year_round.sql` and nothing else. */
const FILENAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

const argv = process.argv.slice(2);
const remoteIdx = argv.indexOf("--remote");
const remotePath = remoteIdx === -1 ? null : argv[remoteIdx + 1];
if (remoteIdx !== -1 && !remotePath) {
  console.error('error: --remote needs a file of "<version> <name>" lines');
  process.exit(2);
}

const errors = [];
const warnings = [];

/** version -> name, from ledger-shaped text. Comments and blanks ignored. */
function parseLedger(text, label) {
  const out = new Map();
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\d{14})\s+(\S+)$/.exec(line);
    if (!m) {
      errors.push(`${label}:${i + 1}: expected "<14-digit version> <name>", got: ${line}`);
      continue;
    }
    if (out.has(m[1])) {
      errors.push(`${label}:${i + 1}: version ${m[1]} listed twice`);
      continue;
    }
    out.set(m[1], m[2]);
  }
  return out;
}

const recorded = parseLedger(readFileSync(LEDGER, "utf8"), "applied_versions.txt");

// ------------------------------------------- the ledger against the database
// Only reached when CI has a database URL. A ledger row the database does not
// have is the forgeable case: the file and the ledger agree with each other,
// and both are wrong.
let remote = null;
if (remotePath) {
  remote = parseLedger(readFileSync(remotePath, "utf8"), remotePath);

  for (const [version, name] of recorded) {
    const actual = remote.get(version);
    if (actual === undefined) {
      errors.push(
        `applied_versions.txt claims version ${version} (${name}), which the database\n` +
          `    has NOT recorded. Adding a version to the ledger does not apply a migration.\n` +
          `    Apply it, then take the version the database assigns.`,
      );
    } else if (actual !== name) {
      errors.push(
        `applied_versions.txt has version ${version} as "${name}"; the database\n` +
          `    recorded it as "${actual}".`,
      );
    }
  }

  const stale = [...remote.keys()].filter((v) => !recorded.has(v));
  if (stale.length) {
    warnings.push(
      `the database has ${stale.length} version${stale.length === 1 ? "" : "s"} the ledger is missing ` +
        `(${stale.slice(0, 3).join(", ")}${stale.length > 3 ? ", …" : ""}).\n` +
        `    Harmless until a file uses one, which would then be rejected here. Refresh the ledger.`,
    );
  }
}

// ----------------------------------------------------------------- the files
const files = readdirSync(DIR).filter((f) => !f.startsWith("."));
const byVersion = new Map();
const bySlug = new Map();

for (const file of files.sort()) {
  const m = FILENAME.exec(file);
  if (!m) {
    errors.push(
      `${file}: not a migration filename. Expected <14-digit version>_<lower_snake_name>.sql`,
    );
    continue;
  }
  const [, version, slug] = m;

  if (byVersion.has(version)) {
    errors.push(`${file}: version ${version} is already used by ${byVersion.get(version)}`);
  }
  byVersion.set(version, file);

  // The database wins where we have it, so a stale ledger cannot green-light a
  // file on its own and cannot fail one the database actually knows.
  const truth = remote ?? recorded;
  const source = remote ? "the database" : "supabase/applied_versions.txt";
  const name = truth.get(version);

  if (name === undefined) {
    errors.push(
      `${file}: version ${version} is not in ${source}.\n` +
        `    The integration would treat this as new work and run it against production.\n` +
        `    If it HAS been applied, use the version the database recorded for it — not the\n` +
        `    one in this filename — and rename the file to match. If it has NOT been applied,\n` +
        `    apply it first, then name the file after the version that comes back.`,
    );
  } else if (name !== slug) {
    errors.push(
      `${file}: version ${version} is recorded in ${source} under the name "${name}",\n` +
        `    not "${slug}". Rename the file to ${version}_${name}.sql, or correct the ledger.`,
    );
  }

  // Not an error: 20260829020645 and 20260829021500 are both recorded as
  // "team_hub", so a repeated slug is legal. It is still how a migration
  // checked in twice under a fresh timestamp looks, so it is worth saying.
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push(file);
}

for (const [slug, group] of bySlug) {
  if (group.length > 1) {
    warnings.push(
      `${group.join(" and ")} share the name "${slug}". Legal if they are genuinely\n` +
        `    separate migrations; if one is the other checked in again, delete it.`,
    );
  }
}

// ---------------------------------------------------------------- the verdict
for (const w of warnings) console.warn(`warning: ${w}`);

if (errors.length) {
  console.error(
    `\n${errors.length} problem${errors.length === 1 ? "" : "s"} in supabase/migrations:\n`,
  );
  for (const e of errors) console.error(`  error: ${e}`);
  console.error(
    `\nsupabase/applied_versions.txt has the refresh query. A recorded version with\n` +
      `no file is fine; a file with no recorded version is what this rejects.\n`,
  );
  process.exit(1);
}

const truth = remote ?? recorded;
const unfiled = [...truth.keys()].filter((v) => !byVersion.has(v)).length;
console.log(
  `supabase/migrations: ${byVersion.size} file${byVersion.size === 1 ? "" : "s"}, ` +
    `each matching a version recorded in ${remote ? "the database" : "the ledger"} ` +
    `(${truth.size} recorded, ${unfiled} with no file, which is fine).`,
);
if (!remote) {
  console.log(
    "note: ledger checked against itself only. Configure SUPABASE_DB_URL in CI to " +
      "check it against the database.",
  );
}
