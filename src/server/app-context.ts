import type { OxigraphService } from "#/worlds/service.ts";
import type { AccountsService } from "#/accounts/service.ts";
import type { LimitsService } from "#/accounts/limit-service.ts";
import { SqliteOxigraphService } from "#/worlds/service-sqlite.ts";
import { SqliteAccountsService } from "#/accounts/service-sqlite.ts";
import { SqliteLimitsService } from "#/accounts/limits-sqlite.ts";
import { openDatabase } from "#/database/database.ts";
import { systemSchema } from "#/database/system.ts";

export interface AppContext {
  oxigraphService: OxigraphService;
  accountsService: AccountsService;
  limitsService: LimitsService;
}

export async function sqliteAppContext(dbPath: string): Promise<AppContext> {
  const db = await openDatabase(dbPath);
  await db.executeMultiple(systemSchema);
  return {
    oxigraphService: new SqliteOxigraphService(db),
    accountsService: new SqliteAccountsService(db),
    limitsService: new SqliteLimitsService(db),
  };
}
