export const rateLimitsTable =
  "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY NOT NULL, tokens REAL NOT NULL, last_refill INTEGER NOT NULL);";

export const selectRateLimitByKey =
  "SELECT key, tokens, last_refill FROM rate_limits WHERE key = ?";

export const insertRateLimit =
  "INSERT INTO rate_limits (key, tokens, last_refill) VALUES (?, ?, ?);";

export const updateRateLimit =
  "UPDATE rate_limits SET tokens = ?, last_refill = ? WHERE key = ?;";
