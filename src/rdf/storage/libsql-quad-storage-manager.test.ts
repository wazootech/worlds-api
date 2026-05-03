import { createLibsqlClient } from "#/core/storage/libsql-client.ts";
import { LibsqlQuadStorageManager } from "./libsql-quad-storage-manager.ts";
import { testQuadStorageManager } from "./testing.ts";

testQuadStorageManager("LibsqlQuadStorageManager", () => {
  const client = createLibsqlClient({ url: ":memory:" });
  return new LibsqlQuadStorageManager(client);
});
