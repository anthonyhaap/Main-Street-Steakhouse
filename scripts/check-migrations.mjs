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
 * Both are caught here, with no database credentials, by checking filenames
 * against a ledger of recorded versions committed alongside them.
 *
 * What this cannot catch: a file correctly named for a recorded version whose
 * CONTENTS are something else. Names are all that is compared. Verifying
 * contents means hashing against schema_migrations.statements, which needs
 * database access this check deliberately does not have.
 *
 * Usage:  node scripts/check-migrations.mjs
 * Exit:   0 clean, 1 on any error below.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(root, "supabase", "applied_versions.txt");
const DIR = join(root, "supabase", "migrations");

/** `20260902011636_commissioner_year_round.sql` and nothing else. */
const FILENAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

const errors = [];
const warnings = [];

// ---------------------------------------------------------------- the ledger
/** version -> recorded name. Comments and blank lines are ignored. */
const recorded = new Map();
for (const [i, raw] of readFileSync(LEDGER, "utf8").split("\n").entries()) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const m = /^(\d{14})\s+(\S+)$/.exec(line);
  if (!m) {
    errors.push(`applied_versions.txt:${i + 1}: expected "<14-digit version> <name>", got: ${line}`);
    continue;
  }
  if (recorded.has(m[1])) {
    errors.push(`applied_versions.txt:${i + 1}: version ${m[1]} listed twice`);
    continue;
  }
  recorded.set(m[1], m[2]);
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

  const name = recorded.get(version);
  if (name === undefined) {
    errors.push(
      `${file}: version ${version} is not in supabase/applied_versions.txt.\n` +
        `    The integration would treat this as new work and run it against production.\n` +
        `    If it HAS been applied, add the version the database recorded for it — not the\n` +
        `    one in this filename — and rename the file to match. If it has NOT been applied,\n` +
        `    apply it first, then name the file after the version that comes back.`,
    );
  } else if (name !== slug) {
    errors.push(
      `${file}: version ${version} is recorded under the name "${name}", not "${slug}".\n` +
        `    Rename the file to ${version}_${name}.sql, or correct the ledger.`,
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
  console.error(`\n${errors.length} problem${errors.length === 1 ? "" : "s"} in supabase/migrations:\n`);
  for (const e of errors) console.error(`  error: ${e}`);
  console.error(
    `\nsupabase/applied_versions.txt has the refresh query. A recorded version with\n` +
      `no file is fine; a file with no recorded version is what this rejects.\n`,
  );
  process.exit(1);
}

const unfiled = [...recorded.keys()].filter((v) => !byVersion.has(v)).length;
console.log(
  `supabase/migrations: ${byVersion.size} file${byVersion.size === 1 ? "" : "s"}, ` +
    `each matching a recorded version (${recorded.size} recorded, ${unfiled} with no file, which is fine).`,
);
