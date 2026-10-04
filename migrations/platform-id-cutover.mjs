import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_ID = "platform-id-cutover-v1";
const WORLD_RELATIONS = [
  { table: "worlds_metadata", legacy: "uid", canonical: "world_id" },
  { table: "api_keys", legacy: "world_uid", canonical: "world_id" },
  { table: "api_keys", legacy: "world_id", canonical: "world_id" },
  { table: "quads", legacy: "world_uid", canonical: "world_id" },
  { table: "quads", legacy: "world_id", canonical: "world_id" },
  { table: "chunks", legacy: "world_uid", canonical: "world_id" },
  { table: "chunks", legacy: "world_id", canonical: "world_id" },
];
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function applyAtomicStatements(database, statements) {
  if (typeof database.executeBatch === "function") {
    await database.executeBatch(statements);
    return;
  }
  if (typeof database.exec === "function") {
    try {
      database.exec(`BEGIN IMMEDIATE;\n${statements.join(";\n")};\nCOMMIT;`);
    } catch (error) {
      try {
        database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
    return;
  }
  throw new Error(
    "Database adapter must support atomic D1 batch execution or SQLite transactions",
  );
}

async function rows(database, sql) {
  const result = await database.prepare(sql).all();
  return Array.isArray(result) ? result : (result.results ?? []);
}

async function tableNames(database) {
  const result = await rows(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return new Set(
    result.map((row) => row.name).filter((name) => !name.startsWith("sqlite_")),
  );
}

async function columnNames(database, table) {
  const result = await rows(
    database,
    `PRAGMA table_info(${quoteIdentifier(table)})`,
  );
  return new Set(result.map((column) => column.name));
}

async function countRows(database, table) {
  const result = await rows(
    database,
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`,
  );
  return Number(result[0]?.row_count ?? 0);
}

async function foreignKeyViolations(database) {
  return rows(database, "PRAGMA foreign_key_check");
}

function addColumnRename(columns, renames, table, legacy, canonical) {
  const fields = columns.get(table);
  if (!fields) {
    throw new Error(`Required table ${table} is missing; refusing the cutover`);
  }
  const hasLegacy = fields.has(legacy);
  const hasCanonical = fields.has(canonical);
  if (hasLegacy && hasCanonical) {
    throw new Error(
      `${table} contains both ${legacy} and ${canonical}; resolve the ambiguity before the cutover`,
    );
  }
  if (!hasLegacy && !hasCanonical) {
    throw new Error(
      `${table} is missing ${canonical}; this schema is unsupported by the cutover`,
    );
  }
  if (hasLegacy) renames.push({ table, from: legacy, to: canonical });
}

async function migrationPlan(database, tables) {
  const worldTable = tables.has("worlds")
    ? "worlds"
    : tables.has("worlds_metadata")
      ? "worlds_metadata"
      : null;
  if (!worldTable) {
    throw new Error(
      "Required world table is missing; expected worlds or the legacy worlds_metadata table",
    );
  }
  if (!tables.has("api_keys")) {
    throw new Error("Required table api_keys is missing; refusing the cutover");
  }

  const relevantTables = new Set([worldTable, "api_keys"]);
  if (worldTable === "worlds" && tables.has("worlds_metadata")) {
    relevantTables.add("worlds_metadata");
  }
  for (const table of ["quads", "chunks"]) {
    if (tables.has(table)) relevantTables.add(table);
  }

  const columns = new Map();
  for (const table of relevantTables) {
    columns.set(table, await columnNames(database, table));
  }

  const renames = [];
  addColumnRename(columns, renames, worldTable, "uid", "world_id");
  if (worldTable === "worlds" && tables.has("worlds_metadata")) {
    addColumnRename(columns, renames, "worlds_metadata", "uid", "world_id");
  }
  addColumnRename(columns, renames, "api_keys", "uid", "api_key_id");

  for (const table of ["api_keys", "quads", "chunks"]) {
    if (!tables.has(table)) continue;
    const fields = columns.get(table);
    if (!fields.has("world_id") && !fields.has("world_uid")) {
      throw new Error(`${table} is missing its world reference column`);
    }
    if (fields.has("world_uid")) {
      addColumnRename(columns, renames, table, "world_uid", "world_id");
    }
  }

  const tableRenames =
    worldTable === "worlds_metadata"
      ? [{ from: "worlds_metadata", to: "worlds" }]
      : [];
  const identityTables = [...relevantTables];
  const verifiedTables = identityTables.map((table) =>
    table === worldTable ? "worlds" : table,
  );
  return {
    columns,
    renames,
    tableRenames,
    worldTable,
    identityTables,
    verifiedTables: [...new Set(verifiedTables)],
  };
}

async function countUnmatchedWorldReferenceRows(
  database,
  tables,
  columns,
  parentTable,
  parentColumn,
) {
  const counts = {};
  for (const table of ["api_keys", "quads", "chunks"]) {
    if (!tables.has(table)) continue;
    const childColumns = columns.get(table);
    const childWorldColumn = childColumns?.has("world_uid")
      ? "world_uid"
      : "world_id";
    if (!childColumns?.has(childWorldColumn)) continue;

    const child = quoteIdentifier(childWorldColumn);
    const parent = quoteIdentifier(parentColumn);
    const result = await rows(
      database,
      `SELECT COUNT(*) AS unmatched_count
       FROM ${quoteIdentifier(table)} AS child
       LEFT JOIN ${quoteIdentifier(parentTable)} AS parent ON parent.${parent} = child.${child}
       WHERE child.${child} IS NOT NULL AND parent.${parent} IS NULL`,
    );
    counts[table] = Number(result[0]?.unmatched_count ?? 0);
  }
  return counts;
}

export async function migratePlatformIds(database, { dryRun = false } = {}) {
  const tables = await tableNames(database);
  const plan = await migrationPlan(database, tables);
  const parentColumn = plan.columns.get(plan.worldTable).has("uid")
    ? "uid"
    : "world_id";
  const initialViolations = await foreignKeyViolations(database);
  if (initialViolations.length > 0) {
    throw new Error(
      `Database has ${initialViolations.length} foreign-key violation(s) before the cutover; repair the source data first`,
    );
  }
  const unmatchedWorldReferenceRowsBefore =
    await countUnmatchedWorldReferenceRows(
      database,
      tables,
      plan.columns,
      plan.worldTable,
      parentColumn,
    );

  const rowCountsBefore = new Map();
  for (const table of plan.identityTables) {
    rowCountsBefore.set(table, await countRows(database, table));
  }
  if (dryRun) {
    return {
      migrationId: MIGRATION_ID,
      dryRun: true,
      migrated: false,
      renames: plan.renames,
      tableRenames: plan.tableRenames,
      rowCounts: Object.fromEntries(rowCountsBefore),
      unmatchedWorldReferenceRows: unmatchedWorldReferenceRowsBefore,
      foreignKeyViolations: 0,
      migrationRecorded: false,
    };
  }

  const modifications = [];
  for (const rename of plan.renames) {
    modifications.push(
      `ALTER TABLE ${quoteIdentifier(rename.table)} RENAME COLUMN ${quoteIdentifier(rename.from)} TO ${quoteIdentifier(rename.to)}`,
    );
  }
  for (const rename of plan.tableRenames) {
    modifications.push(
      `ALTER TABLE ${quoteIdentifier(rename.from)} RENAME TO ${quoteIdentifier(rename.to)}`,
    );
  }
  modifications.push(
    "CREATE TABLE IF NOT EXISTS worlds_api_migrations (migration_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now'))) ",
  );
  modifications.push(
    `INSERT OR IGNORE INTO worlds_api_migrations (migration_id) VALUES ('${MIGRATION_ID}')`,
  );

  await applyAtomicStatements(database, modifications);

  const tablesAfter = await tableNames(database);
  const columnsAfter = new Map();
  for (const table of plan.verifiedTables) {
    columnsAfter.set(table, await columnNames(database, table));
  }
  for (const table of plan.verifiedTables) {
    if (!tablesAfter.has(table)) {
      throw new Error(`Cutover verification failed: ${table} is missing`);
    }
  }
  for (const rename of plan.renames) {
    const table = rename.table === plan.worldTable ? "worlds" : rename.table;
    const fields = columnsAfter.get(table);
    if (!fields.has(rename.to) || fields.has(rename.from)) {
      throw new Error(
        `Cutover verification failed for ${table}; canonical identity columns are incomplete or legacy columns remain`,
      );
    }
  }
  for (const table of ["worlds", "api_keys"]) {
    const fields = columnsAfter.get(table);
    const requiredColumn = table === "worlds" ? "world_id" : "api_key_id";
    if (!fields.has(requiredColumn)) {
      throw new Error(
        `Cutover verification failed: ${table}.${requiredColumn} is missing`,
      );
    }
  }

  const unmatchedWorldReferenceRowsAfter =
    await countUnmatchedWorldReferenceRows(
      database,
      tablesAfter,
      columnsAfter,
      "worlds",
      "world_id",
    );
  if (
    JSON.stringify(unmatchedWorldReferenceRowsAfter) !==
    JSON.stringify(unmatchedWorldReferenceRowsBefore)
  ) {
    throw new Error(
      "Cutover verification failed: unmatched world-reference row counts changed",
    );
  }
  const finalViolations = await foreignKeyViolations(database);
  if (finalViolations.length > 0) {
    throw new Error(
      `Cutover verification found ${finalViolations.length} foreign-key violation(s)`,
    );
  }

  const rowCountsAfter = new Map();
  for (const beforeTable of plan.identityTables) {
    const afterTable = beforeTable === plan.worldTable ? "worlds" : beforeTable;
    const count = await countRows(database, afterTable);
    rowCountsAfter.set(afterTable, count);
    if (count !== rowCountsBefore.get(beforeTable)) {
      throw new Error(
        `Cutover verification failed: ${beforeTable} row count changed from ${rowCountsBefore.get(beforeTable)} to ${count}`,
      );
    }
  }

  return {
    migrationId: MIGRATION_ID,
    dryRun: false,
    migrated: plan.renames.length > 0 || plan.tableRenames.length > 0,
    renames: plan.renames,
    tableRenames: plan.tableRenames,
    rowCounts: Object.fromEntries(rowCountsAfter),
    unmatchedWorldReferenceRows: unmatchedWorldReferenceRowsAfter,
    foreignKeyViolations: 0,
    migrationRecorded: true,
  };
}

class WranglerD1Database {
  constructor({ environment, location, persistTo }) {
    this.environment = environment;
    this.location = location;
    this.persistTo = persistTo;
  }

  prepare(sql) {
    return {
      all: async () => ({ results: this.execute(sql) }),
      run: async () => this.execute(sql),
    };
  }

  execute(sql, inputFlag = "--command") {
    const executable = resolve(repoRoot, "node_modules/.bin/wrangler");
    if (!existsSync(executable)) {
      throw new Error(
        "Install repository dependencies before running this migration",
      );
    }
    const args = ["d1", "execute", "DB"];
    if (this.environment) args.push("--env", this.environment);
    args.push(this.location, "--yes", "--json");
    if (this.persistTo) args.push("--persist-to", this.persistTo);
    args.push(inputFlag, sql);

    const result = spawnSync(executable, args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        result.stderr.trim() ||
          result.stdout.trim() ||
          "Wrangler D1 command failed",
      );
    }

    let output;
    try {
      output = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Wrangler returned invalid JSON: ${result.stdout}`);
    }
    const responses = Array.isArray(output) ? output : [output];
    const failure = responses.find((response) => response.success === false);
    if (failure) {
      throw new Error(JSON.stringify(failure.errors ?? failure, null, 2));
    }
    return responses.flatMap((response) => response.results ?? []);
  }

  executeBatch(statements) {
    const sqlDirectory = mkdtempSync(
      resolve(repoRoot, ".platform-id-cutover-"),
    );
    const sqlFile = join(sqlDirectory, "batch.sql");
    try {
      writeFileSync(sqlFile, `${statements.join(";\n")};\n`, "utf8");
      return this.execute(sqlFile, "--file");
    } finally {
      rmSync(sqlDirectory, { recursive: true, force: true });
    }
  }
}

function parseArgs(args) {
  const options = {
    environment: undefined,
    location: undefined,
    persistTo: undefined,
    dryRun: false,
    confirmWrite: false,
    help: false,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--env") options.environment = args[++index];
    else if (argument === "--local" || argument === "--remote") {
      if (options.location) {
        throw new Error("Choose exactly one of --local or --remote");
      }
      options.location = argument;
    } else if (argument === "--persist-to") options.persistTo = args[++index];
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--confirm-write") options.confirmWrite = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(
      "Usage: npm run migrate:platform-id-cutover -- (--remote --env qa [--dry-run | --confirm-write] | --local --persist-to PATH [--dry-run])",
    );
    return;
  }
  if (!options.location) {
    throw new Error("Choose exactly one of --local or --remote");
  }
  if (options.location === "--remote" && options.environment !== "qa") {
    throw new Error(
      "Remote cutover is restricted to QA; pass --env qa. Production requires a separate approved runbook.",
    );
  }
  if (options.location === "--local" && !options.persistTo) {
    throw new Error("Pass --persist-to when using --local");
  }
  if (
    options.location === "--remote" &&
    !options.dryRun &&
    !options.confirmWrite
  ) {
    throw new Error(
      "Remote writes require --confirm-write after reviewing a dry run and taking a database backup",
    );
  }

  const database = new WranglerD1Database({
    environment: options.environment,
    location: options.location,
    persistTo: options.persistTo,
  });
  const result = await migratePlatformIds(database, { dryRun: options.dryRun });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
