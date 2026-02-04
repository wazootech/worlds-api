import type { Client } from "@libsql/client";
import { insertUsage } from "./queries.sql.ts";

/**
 * UsageService records usage events (e.g. for billing/analytics).
 */
export interface UsageRecord {
  service_account_id: string;
  feature_id: string;
  quantity: number;
  metadata?: string;
}

export class UsageService {
  constructor(private readonly db: Client) {}

  async meter(record: UsageRecord): Promise<void> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    await this.db.execute({
      sql: insertUsage,
      args: [
        id,
        record.service_account_id,
        record.feature_id,
        record.quantity,
        record.metadata ?? null,
        timestamp,
      ],
    });
  }
}
