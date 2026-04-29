import { testChunkIndexManager } from "./testing.ts";
import { OramaChunkIndexManager } from "./orama.ts";

Deno.test("OramaChunkIndexManager: contract", async () => {
  const manager = new OramaChunkIndexManager();
  await testChunkIndexManager(manager);
});
