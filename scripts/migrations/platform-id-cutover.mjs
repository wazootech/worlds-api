import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_ID = "platform-id-cutover-v1";
const CORE_TABLES = ["worlds", "api_keys"];
const OPTIONAL_TABLES = ["worlds_metadata", "quads", "chunks"];
const DATA_TABLES = [...CORE_TABLES, ...OPTIONAL_TABLES];
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "../..");

async function rows(database, sql) {
  const result = await database.prepare(sql).all();
  return Array.isArray(result) ? result : result.results ?? [];
}

async function execute(database, sql) {
  await database.prepare(sql).run();
}

async function tableNames(database) {
  const result = await rows(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return new Set(
    result
      .map((row) => row.name)
      .filter((name) => !name.startsWith("sqlite_")),
  );
}

async function columns(database, table) {
  const result = await rows(database, `PRAGMA table_info(${table})`);
  return new Set(result.map((column) => column.name));
}

function singleIdentityColumn(table, fields, canonical, legacy) {
  const hasCanonical = fields.has(canonical);
  const hasLegacy = fields.has(legacy);
  if (hasCanonical && hasLegacy) {
    throw new Error(
      `${table} contains both ${canonical} and a transitional identity column; resolve the ambiguity before migration`,
    );
  }
  if (!hasCanonical && !hasLegacy) {
    throw new Error(
      `${table} is missing ${canonical}; this schema is not supported by the platform identity cutover`,
    );
  }
  return hasLegacy;
}

async function foreignKeyViolations(database) {
  return rows(database, "PRAGMA foreign_key_check");
}

async function countRows(database, table) {
  const result = await rows(database, `SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result[0]?.count ?? 0);
}

async function assertNoOrphans(database, tables, worldColumn) {
  const relations = [
    ["api_keys", "world_id"],
    ["quads", worldColumn],
    ["chunks", worldColumn],
  ];
  for (const [table, foreignColumn] of relations) {
    if (!tables.has(table)) continue;
    const fields = await columns(database, table);
    if (!fields.has(foreignColumn)) continue;
    const nullable = table === "api_keys" ? " AND child.world_id IS NOT NULL" : "";
    const result = await rows(
      database,
      `SELECT COUNT(*) AS count FROM ${table} child LEFT JOIN worlds parent ON child.${foreignColumn} = parent.${worldColumn} WHERE parent.${worldColumn} IS NULL${nullable}`,
    );
    const count = Number(result[0]?.count ?? 0);
    if (count !== 0) {
      throw new Error(
        `Cannot complete the platform identity cutover: ${table} has ${count} world references without a matching world`,
      );
    }
  }
}

export async function migratePlatformIds(database) {
  const tables = await tableNames(database);
  for (const table of CORE_TABLES) {
    if (!tables.has(table)) {
      throw new Error(`Required table ${table} is missing; refusing migration`);
    }
  }

  const renamePlan = [];
  for (const [table, canonical, legacy] of [
    ["worlds", "world_id", "uid"],
    ["api_keys", "api_key_id", "uid"],
    ["worlds_metadata", "world_id", "uid"],
    ["quads", "world_id", "world_uid"],
    ["chunks", "world_id", "world_uid"],
  ]) {
    if (!tables.has(table)) continue;
    const fields = await columns(database, table);
    const needsRename = singleIdentityColumn(table, fields, canonical, legacy);
    if (needsRename) renamePlan.push([table, legacy, canonical]);
  }

  const initialForeignKeyViolations = await foreignKeyViolations(database);
  if (initialForeignKeyViolations.length > 0) {
    throw new Error(
      `Cannot migrate a database with ${initialForeignKeyViolations.length} existing foreign-key violation(s); repair the source data first`,
    );
  }

  const worldFields = await columns(database, "worlds");
  const oldWorldColumn = worldFields.has("uid") ? "uid" : "world_id";
  await assertNoOrphans(database, tables, oldWorldColumn);

  const countsBefore = new Map();
  for (const table of DATA_TABLES) {
    if (tables.has(table)) countsBefore.set(table, await countRows(database, table));
  }

  for (const [table, oldColumn, newColumn] of renamePlan) {
    await execute(
      database,
      `ALTER TABLE ${table} RENAME COLUMN ${oldColumn} TO ${newColumn}`,
    );
  }

  const tablesAfter = await tableNames(database);
  for (const [table, requiredColumn] of [
    ["worlds", "world_id"],
    ["api_keys", "api_key_id"],
    ...OPTIONAL_TABLES.flatMap((table) =>
      tablesAfter.has(table) ? [[table, "world_id"]] : [],
    ),
  ]) {
    const fields = await columns(database, table);
    if (!fields.has(requiredColumn)) {
      throw new Error(
        `Migration verification failed: ${table}.${requiredColumn} is missing`,
      );
    }
  }

  await assertNoOrphans(database, tablesAfter, "world_id");
  const finalForeignKeyViolations = await foreignKeyViolations(database);
  if (finalForeignKeyViolations.length > 0) {
    throw new Error(
      `Migration verification found ${finalForeignKeyViolations.length} foreign-key violation(s)`,
    );
  }

  for (const [table, countBefore] of countsBefore) {
    const countAfter = await countRows(database, table);
    if (countAfter !== countBefore) {
      throw new Error(
        `Migration verification failed: ${table} row count changed from ${countBefore} to ${countAfter}`,
      );
    }
  }

  await execute(
    database,
    "CREATE TABLE IF NOT EXISTS worlds_api_migrations (migration_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  await execute(
    database,
    `INSERT OR IGNORE INTO worlds_api_migrations (migration_id) VALUES ('${MIGRATION_ID}')`,
  );

  return {
    migrationId: MIGRATION_ID,
    migrated: renamePlan.length > 0,
    renamedColumns: renamePlan.map(([table, from, to]) => ({ table, from, to })),
    verifiedTables: [...countsBefore.keys()],
    foreignKeyViolations: finalForeignKeyViolations.length,
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
      all: async () => ({ results: await this.run(sql) }),
      run: async () => this.run(sql),
    };
  }

  run(sql) {
    const executable = resolve(repoRoot, "node_modules/.bin/wrangler");
    if (!existsSync(executable)) {
      throw new Error("Install repository dependencies before running this migration");
    }
    const args = ["d1", "execute", "worlds-api"];
    if (this.environment) args.push("--env", this.environment);
    args.push(this.location, "--json", "--command", sql);
    if (this.persistTo) args.push("--persist-to", this.persistTo);

    const child = spawnSync(executable, args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (child.status !== 0) {
      throw new Error(
        child.stderr.trim() || child.stdout.trim() || "Wrangler D1 command failed",
      );
    }

    const statements = JSON.parse(child.stdout);
    return statements.flatMap((statement) => statement.results ?? []);
  }
}

function parseArgs(args) {
  const options = { environment: undefined, location: undefined, persistTo: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--env") options.environment = args[++index];
    else if (arg === "--remote" || arg === "--local") options.location = arg;
    else if (arg === "--persist-to") options.persistTo = args[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(
      "Usage: node scripts/migrations/platform-id-cutover.mjs (--remote | --local) [--env qa] [--persist-to PATH]",
    );
    return;
  }
  if (!options.location) {
    throw new Error("Choose exactly one execution target: --remote or --local");
  }
  if (options.location === "--local" && !options.persistTo) {
    throw new Error("Pass --persist-to when using --local");
  }

  const database = new WranglerD1Database({
    environment: options.environment,
    location: options.location,
    persistTo: options.persistTo,
  });
  const result = await migratePlatformIds(database);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
