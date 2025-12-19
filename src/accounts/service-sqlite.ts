import type { Client } from "#/database/database.ts";
import type {
  Account,
  AccountPlan,
  AccountsService,
  AccountUsageEvent,
  AccountUsageSummary,
} from "#/accounts/service.ts";
import type {
  AccountRow,
  ApiKeyRow,
  UsageBucketRow,
} from "#/database/system.ts";

export class SqliteAccountsService implements AccountsService {
  constructor(private readonly db: Client) {}

  async set(account: Account): Promise<void> {
    const existing = await this.get(account.id);

    // Upsert Account
    await this.db.execute({
      sql: `
        INSERT INTO kb_accounts (account_id, description, plan, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
          description = excluded.description,
          plan = excluded.plan,
          updated_at = excluded.updated_at
      `,
      args: [
        account.id,
        account.description,
        account.plan,
        existing ? 0 : Date.now(), // Ignored by ON CONFLICT if updating, but needed for INSERT
        Date.now(),
      ],
    });

    const keyPrefix = account.apiKey.substring(0, 8);
    await this.db.execute({
      sql: `
        INSERT OR REPLACE INTO kb_api_keys (key_hash, account_id, key_prefix, created_at)
        VALUES (?, ?, ?, ?)
      `,
      args: [
        account.apiKey,
        account.id,
        keyPrefix,
        Date.now(),
      ],
    });
  }

  async get(id: string): Promise<Account | null> {
    const accountResult = await this.db.execute({
      sql: "SELECT * FROM kb_accounts WHERE account_id = ?",
      args: [id],
    });
    const accountRow = accountResult.rows[0] as unknown as
      | AccountRow
      | undefined;

    if (!accountRow) return null;

    const apiKeyResult = await this.db.execute({
      sql: "SELECT * FROM kb_api_keys WHERE account_id = ?",
      args: [id],
    });
    const apiKeyRow = apiKeyResult.rows[0] as unknown as ApiKeyRow | undefined;

    const worldsResult = await this.db.execute({
      sql: "SELECT world_id FROM kb_worlds WHERE account_id = ?",
      args: [id],
    });
    const worlds = worldsResult.rows as unknown as { world_id: string }[];

    const account: Account = {
      id: accountRow.account_id,
      apiKey: apiKeyRow?.key_hash ?? "",
      description: accountRow.description ?? "",
      plan: accountRow.plan as AccountPlan,
      accessControl: {
        worlds: worlds.map((w) => w.world_id),
      },
    };

    return account;
  }

  async getByApiKey(apiKey: string): Promise<Account | null> {
    const result = await this.db.execute({
      sql: "SELECT account_id FROM kb_api_keys WHERE key_hash = ?",
      args: [apiKey],
    });
    const keyRow = result.rows[0] as unknown as
      | { account_id: string }
      | undefined;

    if (!keyRow) return null;
    return this.get(keyRow.account_id);
  }

  async remove(id: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM kb_accounts WHERE account_id = ?",
      args: [id],
    });
  }

  async meter(event: AccountUsageEvent): Promise<void> {
    const bucketStartTs = 0;
    let formattedEndpoint = event.endpoint as string;
    for (const [key, value] of Object.entries(event.params)) {
      formattedEndpoint = formattedEndpoint.replace(`{${key}}`, value);
    }

    await this.db.execute({
      sql: `
        INSERT INTO kb_usage (bucket_start_ts, account_id, endpoint, request_count, token_in_count, token_out_count)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(bucket_start_ts, account_id, endpoint) DO UPDATE SET
          request_count = request_count + 1,
          token_in_count = token_in_count + excluded.token_in_count,
          token_out_count = token_out_count + excluded.token_out_count
      `,
      args: [bucketStartTs, event.accountId, formattedEndpoint, 1, 0, 0],
    });
  }

  async getUsageSummary(
    accountId: string,
  ): Promise<AccountUsageSummary | null> {
    const result = await this.db.execute({
      sql: "SELECT endpoint, request_count FROM kb_usage WHERE account_id = ?",
      args: [accountId],
    });
    const rows = result.rows as unknown as UsageBucketRow[];

    if (rows.length === 0) return null;

    const summary: AccountUsageSummary = { worlds: {} };

    for (const row of rows) {
      const parts = row.endpoint.split("/");
      const worldsIndex = parts.indexOf("worlds");
      if (worldsIndex === -1 || worldsIndex + 1 >= parts.length) continue;

      const worldId = parts[worldsIndex + 1];

      if (!summary.worlds[worldId]) {
        summary.worlds[worldId] = {
          reads: 0,
          writes: 0,
          queries: 0,
          updates: 0,
          updatedAt: Date.now(),
        };
      }

      const s = summary.worlds[worldId];
      if (row.endpoint.includes("/sparql")) {
        if (row.endpoint.startsWith("POST")) s.updates += row.request_count;
        else s.queries += row.request_count;
      } else {
        if (row.endpoint.startsWith("GET")) s.reads += row.request_count;
        else if (
          row.endpoint.startsWith("POST") || row.endpoint.startsWith("PUT") ||
          row.endpoint.startsWith("PATCH") || row.endpoint.startsWith("DELETE")
        ) s.writes += row.request_count;
      }
    }

    return summary;
  }

  async listAccounts(): Promise<Account[]> {
    const result = await this.db.execute("SELECT account_id FROM kb_accounts");
    const rows = result.rows as unknown as { account_id: string }[];

    // We can run these in parallel
    return Promise.all(
      rows.map((r) => this.get(r.account_id) as Promise<Account>),
    );
  }

  async addWorldAccess(accountId: string, worldId: string): Promise<void> {
    await this.db.execute({
      sql: `
        INSERT INTO kb_worlds (world_id, account_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(world_id) DO UPDATE SET account_id = excluded.account_id
      `,
      args: [worldId, accountId, "World " + worldId, Date.now(), Date.now()],
    });
  }

  async removeWorldAccess(accountId: string, worldId: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM kb_worlds WHERE world_id = ? AND account_id = ?",
      args: [worldId, accountId],
    });
  }
}
