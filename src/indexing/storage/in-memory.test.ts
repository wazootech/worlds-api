import { testChunkIndexManager } from "./testing.ts";
import { InMemoryChunkIndexManager } from "./in-memory.ts";

Deno.test("InMemoryChunkIndexManager: contract", async () => {
  const manager = new InMemoryChunkIndexManager();
  await testChunkIndexManager(manager);
});
