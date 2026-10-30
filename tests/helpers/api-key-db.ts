// A mock D1 that answers the auth layer's `api_keys` lookups from a map keyed by
// token hash. Everything else returns empty results.
export function createApiKeyDb(apiKeyRows: Record<string, any>) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          if (sql.includes("api_keys") && args[0]) {
            const row = apiKeyRows[args[0] as string];
            return { results: row ? [row] : [] };
          }
          return { results: [] };
        },
        first: async () => {
          if (sql.includes("api_keys") && args[0]) {
            return apiKeyRows[args[0] as string] ?? null;
          }
          return null;
        },
        run: async () => ({ results: [], meta: { changes: 1 } }),
      }),
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ results: [], meta: { changes: 1 } }),
    }),
    batch: async () => [],
    exec: async () => {},
  } as any;
}
