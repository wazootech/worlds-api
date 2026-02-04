import type { Client } from "@libsql/client";
import { insertMetric } from "./queries.sql.ts";

/**
 * MetricsService records metrics (formerly usage events).
 */
export interface MetricRecord {
  service_account_id: string;
  feature_id: string;
  quantity: number;
  metadata?: string;
}

export class MetricsService {
  constructor(private readonly db: Client) {}

  async record(record: MetricRecord): Promise<void> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    await this.db.execute({
      sql: insertMetric,
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
