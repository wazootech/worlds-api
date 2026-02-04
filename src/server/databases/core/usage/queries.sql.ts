export const usageTable =
  "CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY NOT NULL, service_account_id TEXT NOT NULL, feature_id TEXT NOT NULL, quantity INTEGER NOT NULL, metadata TEXT, timestamp INTEGER NOT NULL);";

export const usageServiceAccountIdIndex =
  "CREATE INDEX IF NOT EXISTS idx_usage_service_account_id ON usage(service_account_id);";

export const insertUsage =
  "INSERT INTO usage (id, service_account_id, feature_id, quantity, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?);";
