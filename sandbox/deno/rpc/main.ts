import { ApiKeyStorage } from "#/api-keys/api-key-storage.ts";
import { generateApiKey, hashKey } from "#/api-keys/api-key.ts";
import { createLibsqlClient } from "#/core/storage/libsql-client.ts";
import { createRpcApp } from "#/rpc/mod.ts";

const dataDir = "sandbox/deno/rpc/.data";
await Deno.mkdir(dataDir, { recursive: true });

const dbUrl = "file:./sandbox/deno/rpc/.data/api-keys.db";
const client = createLibsqlClient({ url: dbUrl });
const apiKeyStorage = new ApiKeyStorage(client);

const apiKey = generateApiKey();
await apiKeyStorage.createKey({
  id: crypto.randomUUID(),
  keyHash: await hashKey(apiKey),
  userId: "demo-user",
  scopes: ["*"],
  createdAt: Date.now(),
});

const envPort = Deno.env.get("PORT");
const parsedPort = envPort !== undefined && envPort.trim().length > 0
  ? Number(envPort)
  : 8001;
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8001;

const app = createRpcApp({ apiKeyStorage });

console.log("Worlds RPC demo server running");
console.log(`POST /rpc -> http://localhost:${port}/rpc`);
console.log("X-Api-Key:", apiKey);
console.log(
  "Client: WORLDS_API_KEY=... deno run -A sandbox/deno/rpc/client.ts",
);

Deno.serve({ port }, (req) => app.fetch(req));
