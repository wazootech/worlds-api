import { type Client } from "@libsql/client";

export interface StoredApiKey {
  id: string;
  keyHash: string;
  label?: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
}

export class ApiKeyStorage {
  private initialized = false;

  constructor(private readonly client: Client) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        label TEXT,
        scopes TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        last_used_at INTEGER
      )
    `);
    this.initialized = true;
  }

  async createKey(key: StoredApiKey): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql:
        `INSERT INTO api_keys (id, key_hash, label, scopes, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        key.id,
        key.keyHash,
        key.label ?? null,
        JSON.stringify(key.scopes),
        key.createdAt,
        key.expiresAt ?? null,
      ],
    });
  }

  async findByHash(keyHash: string): Promise<StoredApiKey | null> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`,
      args: [keyHash],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, unknown>;
    return {
      id: row["id"] as string,
      keyHash: row["key_hash"] as string,
      label: row["label"] as string | undefined,
      scopes: JSON.parse(row["scopes"] as string),
      createdAt: row["created_at"] as number,
      expiresAt: row["expires_at"] as number | undefined,
      revokedAt: row["revoked_at"] as number | undefined,
      lastUsedAt: row["last_used_at"] as number | undefined,
    };
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE api_keys SET revoked_at = ? WHERE id = ?`,
      args: [Date.now(), keyId],
    });
  }

  async touchLastUsed(keyId: string): Promise<void> {
    await this.client.execute({
      sql: `UPDATE api_keys SET last_used_at = ? WHERE id = ?`,
      args: [Date.now(), keyId],
    });
  }
}
