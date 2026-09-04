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
 * With `--remote` the dump also carries each migration's statements, and the
 * FILE is compared against them. That is the third way this went wrong: a file
 * correctly named for a recorded version whose body is something else passes
 * every check above. It never runs against production — the version is already
 * in the history — so nothing breaks and nobody notices, but a preview branch
 * replays the file, and quietly builds a database that is not a copy of
 * production. Two were found that way: a missing `nulls last`, and a pair of
 * revokes that had been dropped from a security migration.
 *
 * The comparison normalizes what the SQL editor, psql and a documenting hand
 * legitimately change — line endings, reflowed statements, comments, $fn$ vs $$
 * — so only a real difference in the SQL fails. Files that differ for a known
 * and argued reason are listed in CONTENT_EXCEPTIONS.
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

/**
 * version -> { name, sql }, from ledger-shaped text. Comments and blanks ignored.
 *
 * A third field is optional and only the --remote dump carries it: the migration's
 * recorded statements, base64 encoded because they contain newlines and quotes.
 * `sql` is null for the committed ledger, which records names and nothing else.
 */
function parseLedger(text, label) {
  const out = new Map();
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\d{14})\s+(\S+)(?:\s+([A-Za-z0-9+/=]*))?$/.exec(line);
    if (!m) {
      errors.push(`${label}:${i + 1}: expected "<14-digit version> <name>", got: ${line}`);
      continue;
    }
    if (out.has(m[1])) {
      errors.push(`${label}:${i + 1}: version ${m[1]} listed twice`);
      continue;
    }
    const sql = m[3] ? Buffer.from(m[3], "base64").toString("utf8") : null;
    out.set(m[1], { name: m[2], sql });
  }
  return out;
}

/**
 * The same migration, written two ways, should compare equal.
 *
 * What a file says and what the database recorded differ for reasons that are
 * not drift: the SQL editor reflows statements onto one line, `psql` and the
 * dashboard disagree about line endings, `$fn$` and `$$` are the same quote,
 * and a file is often the documented version of what was run. None of that
 * changes what the migration does, so none of it should fail a build. Anything
 * left after this is a real difference in the SQL.
 */
function normalizeSql(s) {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* */ and /** */ comments
    .replace(/--[^\n]*/g, " ") // -- comments
    .replace(/\$[a-zA-Z_]\w*\$/g, "$$$$") // $fn$ / $body$ -> $$
    .replace(/\s+/g, " ")
    .replace(/\s*([(),;])\s*/g, "$1")
    .trim()
    .toLowerCase();
}

/**
 * Files whose body legitimately differs from the statements recorded for them.
 *
 * Every entry is a case where the FILE is the more complete text, checked by
 * hand against the live schema. They are listed rather than normalized away so
 * that the list stays short and each exception has to be argued for.
 */
const CONTENT_EXCEPTIONS = new Map([
  [
    "20260826022327",
    "file also revokes ff_backfill_bye_weeks from public/anon, which 20260826023254 " +
      "did on the live project. Idempotent, and it belongs beside the function.",
  ],
  [
    "20260827034158",
    "file adds `comment on function ff_league_pulse`, which is documentation the " +
      "live project never had.",
  ],
  [
    "20260904003458",
    "recorded statement is the note 'Applied from the checked-in migration through " +
      "the Supabase SQL editor.' — prose, not SQL. The file is the migration.",
  ],
  [
    "20260829051500",
    "applied through the SQL editor, which recorded no statements at all. The live " +
      "ff_team_hub matches this file's, so the file is the migration.",
  ],
]);

const recorded = parseLedger(readFileSync(LEDGER, "utf8"), "applied_versions.txt");

// ------------------------------------------- the ledger against the database
// Only reached when CI has a database URL. A ledger row the database does not
// have is the forgeable case: the file and the ledger agree with each other,
// and both are wrong.
let remote = null;
if (remotePath) {
  remote = parseLedger(readFileSync(remotePath, "utf8"), remotePath);

  for (const [version, { name }] of recorded) {
    const actual = remote.get(version);
    if (actual === undefined) {
      errors.push(
        `applied_versions.txt claims version ${version} (${name}), which the database\n` +
          `    has NOT recorded. Adding a version to the ledger does not apply a migration.\n` +
          `    Apply it, then take the version the database assigns.`,
      );
    } else if (actual.name !== name) {
      errors.push(
        `applied_versions.txt has version ${version} as "${name}"; the database\n` +
          `    recorded it as "${actual.name}".`,
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
  const entry = truth.get(version);
  const name = entry?.name;

  if (entry === undefined) {
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

  // ------------------------------------------ the file against what was run
  // Only possible with --remote, which carries the statements. A file named for
  // a recorded version whose BODY is something else passes every check above:
  // it never runs against production, but it is what a preview branch builds
  // from, so the branch quietly stops being a copy of production.
  if (entry?.sql != null) {
    const wanted = normalizeSql(entry.sql);
    const got = normalizeSql(readFileSync(join(DIR, file), "utf8"));
    if (wanted !== got) {
      const why = CONTENT_EXCEPTIONS.get(version);
      if (why) {
        warnings.push(`${file}: body differs from the recorded statements. Known and allowed:\n    ${why}`);
      } else {
        errors.push(
          `${file}: the body does not match the statements the database recorded for\n` +
            `    version ${version} (compared with comments, line breaks and $tag$ quoting\n` +
            `    normalized away, so this is a real difference in the SQL).\n` +
            `    This file has already been applied, so production is unaffected — but a\n` +
            `    preview branch replays THIS text, and would build a different database.\n` +
            `    Correct the file to what was run, or add ${version} to CONTENT_EXCEPTIONS\n` +
            `    in this script with the reason.`,
        );
      }
    }
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
const compared = [...byVersion.keys()].filter((v) => truth.get(v)?.sql != null).length;
console.log(
  `supabase/migrations: ${byVersion.size} file${byVersion.size === 1 ? "" : "s"}, ` +
    `each matching a version recorded in ${remote ? "the database" : "the ledger"} ` +
    `(${truth.size} recorded, ${unfiled} with no file, which is fine).`,
);
if (compared) {
  console.log(
    `contents: ${compared} file${compared === 1 ? "" : "s"} compared against the statements the ` +
      `database recorded, ${CONTENT_EXCEPTIONS.size} known exceptions allowed.`,
  );
}
if (!remote) {
  console.log(
    "note: ledger checked against itself only, and bodies not checked at all. " +
      "Configure SUPABASE_DB_URL in CI to check both against the database.",
  );
}
