import { beforeAll, beforeEach, vi } from "vitest";
import app from "../../src/app";
import type { Env } from "../../src/env";
import { getDb } from "../../src/lib/db";
import { resolveWorldDatabase, getWorldSdk } from "../../src/lib/world-db";
import { sha256Hex } from "../../src/lib/crypto";
import { createApiKeyDb } from "./api-key-db";

// The calling test file declares vi.mock for "src/lib/world-db" and "src/lib/db".
const getDbMock = vi.mocked(getDb);
export const getWorldSdkMock = vi.mocked(getWorldSdk);
export const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);

export const env = {
  DB: {} as any,
  WORLDS_API_ADMIN_KEY: "test-admin-key",
  RATE_LIMIT_RPM: "6000",
  RATE_LIMIT_BURST: "1000",
  MAX_IMPORT_QUADS: "10",
  MAX_IMPORT_BYTES: "1048576",
  SPARQL_MAX_QUERY_LENGTH: "100",
  SPARQL_MAX_RESULTS: "10",
  WAZOO_ENV: "test",
} as unknown as Env;

export const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

export const READ_ONLY_TOKEN = "test-read-only-token";
export const FULL_TOKEN = "test-full-token";

export const worldRef = {
  worldId: "w_00000000000000000000000001",
  namespace: "ns",
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};

export function request(
  token: string | null,
  path: string,
  init: RequestInit = {},
) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        ...(init.headers as Record<string, string>),
      },
    },
    env,
    executionCtx,
  );
}

/** Registers the shared hooks: token hashes once, fresh mocks per test. */
export function useAbuseMocks() {
  let readOnlyHashVal = "";
  let fullHashVal = "";

  beforeAll(async () => {
    readOnlyHashVal = await sha256Hex(READ_ONLY_TOKEN);
    fullHashVal = await sha256Hex(FULL_TOKEN);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorldDatabaseMock.mockResolvedValue(worldRef as never);
    getWorldSdkMock.mockResolvedValue({
      sparql: vi
        .fn()
        .mockResolvedValue({ kind: "ask", data: { boolean: true } }),
      import: vi.fn().mockResolvedValue({}),
    } as never);

    // Mock D1 for auth queries.
    getDbMock.mockReturnValue(
      createApiKeyDb({
        [readOnlyHashVal]: {
          namespace: "ns",
          world_id: null,
          scopes: '["data:read"]',
        },
        [fullHashVal]: {
          namespace: "ns",
          world_id: null,
          scopes: '["data:read","data:write"]',
        },
      }) as never,
    );
  });
}
