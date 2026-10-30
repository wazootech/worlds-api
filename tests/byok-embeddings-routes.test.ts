import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import {} from "../src/lib/embeddings/envelope";
import {} from "../src/lib/embeddings/catalog";
import {} from "../src/lib/embeddings/provider";
import {
  getCredential,
  getWorldState,
  setCredential,
  setWorldState,
} from "../src/lib/embeddings/store";
import { clearSdkCache, getWorldSdk } from "../src/lib/world-db";
import {
  addApiKey,
  addWorld,
  createSdkMock,
  db,
  http,
  makeEnv,
  MODEL,
  SECRET_KEY,
  useEmbeddingsHarness,
  WORLD_A,
} from "./helpers/byok-embeddings-harness";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));

useEmbeddingsHarness();

describe("credential routes", () => {
  const base = "/namespaces/ns-1/embedding-providers";
  const path = `${base}/openai`;
  const put = (
    env: Env,
    token: string | null,
    body: unknown = { apiKey: SECRET_KEY },
    provider = "openai",
  ) =>
    http(env, token, `${base}/${provider}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    await addApiKey("ns-admin-token", "ns-1", ["embeddings:admin"]);
    await addApiKey("ns-default-token", "ns-1", ["data:read", "data:write"]);
    await addApiKey(
      "ns-world-token",
      "ns-1",
      ["data:read", "data:write", "embeddings:admin"],
      WORLD_A,
    );
    await addApiKey("other-ns-token", "ns-2", ["embeddings:admin"]);
  });

  it("stores, reports metadata only, and never returns or logs the key", async () => {
    const logs: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logs.push(args);
      });
    }
    const env = makeEnv();

    const res = await put(env, "ns-admin-token");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET_KEY);
    expect(JSON.parse(text)).toMatchObject({
      provider: "openai",
      status: "active",
      last4: SECRET_KEY.slice(-4),
    });

    const got = await http(env, "ns-admin-token", path);
    expect(got.status).toBe(200);
    expect(await got.text()).not.toContain(SECRET_KEY);

    // Bad key format: rejected without echoing the input.
    const bad = await put(env, "ns-admin-token", {
      apiKey: "has space  inside-it-which-is-bad",
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("inside-it");

    expect(JSON.stringify(logs)).not.toContain(SECRET_KEY);
  });

  it("requires the embeddings:admin scope; default grants and world tokens are refused", async () => {
    const env = makeEnv();
    expect((await put(env, "ns-default-token")).status).toBe(403);
    expect((await http(env, "ns-default-token", path)).status).toBe(403);
    expect(
      (await http(env, "ns-default-token", path, { method: "DELETE" })).status,
    ).toBe(403);
    expect((await put(env, "ns-world-token")).status).toBe(403);
    expect((await put(env, null)).status).toBe(401);
    expect((await put(env, "other-ns-token")).status).toBe(403);
    expect(await getCredential(env, "ns-1", "openai")).toBeNull();
    expect((await put(env, "admin-key")).status).toBe(200);
  });

  it("fails closed with 503 when the deployment has no KEK", async () => {
    const env = makeEnv({ EMBEDDING_KEK_V1: undefined });
    const res = await put(env, "ns-admin-token");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe(
      "EMBEDDINGS_NOT_CONFIGURED",
    );
    expect(await getCredential(env, "ns-1", "openai")).toBeNull();
  });

  it("revokes via DELETE and 404s when there is nothing to revoke", async () => {
    const env = makeEnv();
    expect(
      (await http(env, "ns-admin-token", path, { method: "DELETE" })).status,
    ).toBe(404);
    await put(env, "ns-admin-token");
    expect(
      (await http(env, "ns-admin-token", path, { method: "DELETE" })).status,
    ).toBe(204);
    const got = await http(env, "ns-admin-token", path);
    expect(((await got.json()) as any).status).toBe("revoked");
  });

  it("addresses each provider's credential by path and lists them", async () => {
    const env = makeEnv();
    await put(env, "ns-admin-token");
    await put(
      env,
      "ns-admin-token",
      { apiKey: "or-key-0123456789abcdefghij" },
      "openrouter",
    );

    const got = await http(env, "ns-admin-token", `${base}/openrouter`);
    expect(((await got.json()) as any).provider).toBe("openrouter");
    const openai = await http(env, "ns-admin-token", path);
    expect(((await openai.json()) as any).provider).toBe("openai");

    const list = await http(env, "ns-admin-token", base);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as any;
    expect(listed.providers.map((p: any) => p.provider).sort()).toEqual([
      "openai",
      "openrouter",
    ]);
    expect(JSON.stringify(listed)).not.toContain(SECRET_KEY);

    // Revoking one provider leaves the other active.
    expect(
      (
        await http(env, "ns-admin-token", `${base}/openrouter`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect((await getCredential(env, "ns-1", "openai"))?.status).toBe("active");
    expect((await getCredential(env, "ns-1", "openrouter"))?.status).toBe(
      "revoked",
    );
  });

  it("lists nothing for a namespace with no credentials and requires the scope", async () => {
    const env = makeEnv();
    const empty = await http(env, "ns-admin-token", base);
    expect(((await empty.json()) as any).providers).toEqual([]);
    expect((await http(env, "ns-default-token", base)).status).toBe(403);
    expect((await http(env, null, base)).status).toBe(401);
  });

  it("rejects a provider outside the vetted list", async () => {
    const env = makeEnv();
    expect(
      (await put(env, "ns-admin-token", { apiKey: SECRET_KEY }, "cohere"))
        .status,
    ).toBe(400);
    expect((await http(env, "ns-admin-token", `${base}/cohere`)).status).toBe(
      400,
    );
  });

  it("namespace deletion revokes the credential", async () => {
    const env = makeEnv();
    await put(env, "ns-admin-token");
    const res = await http(env, "admin-key", "/admin/namespaces/ns-1/delete", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await getCredential(env, "ns-1", "openai"))?.status).toBe(
      "revoked",
    );
  });
});

describe("worlds: validation, stale-on-model-change, status", () => {
  beforeEach(async () => {
    await addApiKey("w-token", "ns-1", ["data:read", "data:write"]);
    await addApiKey("ns-admin-token", "ns-1", ["embeddings:admin"]);
    await addWorld(WORLD_A, "ns-1");
  });

  const patch = (env: Env, body: unknown) =>
    http(env, "w-token", `/worlds/${WORLD_A}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

  it("rejects non-allowlisted models on create and PATCH", async () => {
    const env = makeEnv();
    expect(
      (await patch(env, { embeddingModel: "cohere/embed-v4" })).status,
    ).toBe(400);
    const create = await http(env, "w-token", "/worlds", {
      method: "POST",
      body: JSON.stringify({ embeddingModel: "https://evil.example/embed" }),
    });
    expect(create.status).toBe(400);
  });

  it("existing non-allowlisted values read as unconfigured", async () => {
    const res = await http(makeEnv(), "w-token", `/worlds/${WORLD_A}`);
    const body = (await res.json()) as any;
    expect(body.embeddingModel).toBe("tfjs-universal-sentence-encoder");
    expect(body.embeddingStatus).toBe("unconfigured");
  });

  it("requires a credential to choose a model", async () => {
    const res = await patch(makeEnv(), { embeddingModel: MODEL });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe(
      "EMBEDDING_CREDENTIAL_REQUIRED",
    );
  });

  it("needs a credential for the chosen model's provider, not just any credential", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    const openrouterModel = "openrouter/openai/text-embedding-3-small";
    const refused = await patch(env, { embeddingModel: openrouterModel });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as any).error.code).toBe(
      "EMBEDDING_CREDENTIAL_REQUIRED",
    );

    await setCredential(
      env,
      "ns-1",
      "openrouter",
      "or-key-0123456789abcdefghij",
    );
    const ok = await patch(env, { embeddingModel: openrouterModel });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).embeddingStatus).toBe("stale");
  });

  it("marks the world stale on model change and stays keyword-only until reindex", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    await setWorldState(env, WORLD_A, "ready", MODEL);
    await db
      .prepare("UPDATE worlds SET embedding_model = ? WHERE world_id = ?")
      .bind(MODEL, WORLD_A)
      .run();
    expect(
      ((await (await http(env, "w-token", `/worlds/${WORLD_A}`)).json()) as any)
        .embeddingStatus,
    ).toBe("ready");

    const res = await patch(env, {
      embeddingModel: "openai/text-embedding-3-large",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.embeddingModel).toBe("openai/text-embedding-3-large");
    expect(body.embeddingStatus).toBe("stale");
    expect(await getWorldState(env, WORLD_A)).toMatchObject({
      state: "stale",
      model: "openai/text-embedding-3-large",
    });

    // Search wiring: no embedder while stale.
    clearSdkCache();
    await getWorldSdk(
      env,
      {
        worldId: WORLD_A,
        namespace: "ns-1",
        embeddingModel: "openai/text-embedding-3-large",
        chunkSize: 1000,
        topK: 5,
        minScore: 0,
      },
      10,
    );
    expect(createSdkMock.mock.calls.at(-1)![0]).not.toHaveProperty(
      "embeddingService",
    );
  });

  it("an unchanged model does not reset state", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    await db
      .prepare("UPDATE worlds SET embedding_model = ? WHERE world_id = ?")
      .bind(MODEL, WORLD_A)
      .run();
    await setWorldState(env, WORLD_A, "ready", MODEL);
    await patch(env, { embeddingModel: MODEL, displayName: "renamed" });
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
  });
});
