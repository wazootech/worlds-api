import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { sha256Hex } from "../src/lib/crypto";
import {
  credentialAad,
  currentKek,
  kekForVersion,
  openKey,
  sealKey,
} from "../src/lib/embeddings/envelope";
import {} from "../src/lib/embeddings/catalog";
import {} from "../src/lib/embeddings/provider";
import {
  AUTH_FAILURE_THRESHOLD,
  getCredential,
  getWorldState,
  invalidateKeyCache,
  recordAuthFailure,
  remainingBudget,
  reserveBudget,
  resolveApiKey,
  revokeCredential,
  setCredential,
  setWorldState,
} from "../src/lib/embeddings/store";
import {
  addWorld,
  db,
  kek2,
  makeEnv,
  SECRET_KEY,
  useEmbeddingsHarness,
  WORLD_A,
} from "./helpers/byok-embeddings-harness";

vi.mock("@worlds/cloudflare", () => ({
  createCloudflareWorldsSdk: vi.fn(),
}));

useEmbeddingsHarness();

describe("envelope encryption", () => {
  const aad = credentialAad("ns", "cred-1", "openai");

  it("round-trips and uses a fresh IV per seal", async () => {
    const kek = (await currentKek(makeEnv()))!;
    const a = await sealKey(kek, SECRET_KEY, aad);
    const b = await sealKey(kek, SECRET_KEY, aad);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toContain(SECRET_KEY);
    expect(await openKey(kek, a, aad)).toBe(SECRET_KEY);
  });

  it("rejects tampered ciphertext, wrong AAD (other namespace), and wrong KEK", async () => {
    const env = makeEnv({ EMBEDDING_KEK_V2: kek2 });
    const kek = (await kekForVersion(env, 1))!;
    const other = (await kekForVersion(env, 2))!;
    const sealed = await sealKey(kek, SECRET_KEY, aad);

    const flipped = atob(sealed.ciphertext).split("");
    flipped[0] = String.fromCharCode(flipped[0].charCodeAt(0) ^ 1);
    expect(
      await openKey(
        kek,
        { ...sealed, ciphertext: btoa(flipped.join("")) },
        aad,
      ),
    ).toBeNull();
    expect(
      await openKey(kek, sealed, credentialAad("other-ns", "cred-1", "openai")),
    ).toBeNull();
    expect(await openKey(other, sealed, aad)).toBeNull();
  });

  it("treats an absent or malformed KEK as unavailable", async () => {
    expect(
      await currentKek(makeEnv({ EMBEDDING_KEK_V1: undefined })),
    ).toBeNull();
    expect(
      await currentKek(makeEnv({ EMBEDDING_KEK_V1: "c2hvcnQ=" })),
    ).toBeNull();
    expect(await currentKek(makeEnv({ EMBEDDING_KEK_V1: "!!!" }))).toBeNull();
  });
});

describe("credential store: one key per provider", () => {
  const OR_KEY = "or-key-0123456789abcdefghij";

  it("keeps a separate key, cache slot and revoke per provider", async () => {
    const env = makeEnv();
    await setCredential(env, "ns", "openai", SECRET_KEY);
    await setCredential(env, "ns", "openrouter", OR_KEY);
    expect((await resolveApiKey(env, "ns", "openai"))?.key).toBe(SECRET_KEY);
    expect((await resolveApiKey(env, "ns", "openrouter"))?.key).toBe(OR_KEY);
    // Cached reads must not cross providers either.
    expect((await resolveApiKey(env, "ns", "openai"))?.key).toBe(SECRET_KEY);

    await revokeCredential(env, "ns", "openrouter");
    expect(await resolveApiKey(env, "ns", "openrouter")).toBeNull();
    expect((await resolveApiKey(env, "ns", "openai"))?.key).toBe(SECRET_KEY);
    expect((await getCredential(env, "ns", "openai"))?.status).toBe("active");
  });

  it("revoking one provider only stales worlds on that provider's models", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-1", "openai", SECRET_KEY);
    await setCredential(env, "ns-1", "openrouter", OR_KEY);
    await addWorld(WORLD_A, "ns-1");
    await db
      .prepare("UPDATE worlds SET embedding_model = ? WHERE world_id = ?")
      .bind("openrouter/openai/text-embedding-3-small", WORLD_A)
      .run();
    await setWorldState(
      env,
      WORLD_A,
      "ready",
      "openrouter/openai/text-embedding-3-small",
    );
    await revokeCredential(env, "ns-1", "openai");
    expect((await getWorldState(env, WORLD_A))?.state).toBe("ready");
    await revokeCredential(env, "ns-1", "openrouter");
    expect((await getWorldState(env, WORLD_A))?.state).toBe("stale");
  });
});

describe("credential store", () => {
  it("fails closed with no KEK and writes nothing", async () => {
    const env = makeEnv({ EMBEDDING_KEK_V1: undefined });
    expect(await setCredential(env, "ns", "openai", SECRET_KEY)).toEqual({
      ok: false,
      reason: "kek_unavailable",
    });
    expect(await getCredential(env, "ns", "openai")).toBeNull();
  });

  it("stores ciphertext only, exposes fingerprint/last4, and resolves the key", async () => {
    const env = makeEnv();
    const res = await setCredential(env, "ns", "openai", SECRET_KEY);
    expect(res.ok).toBe(true);
    const row = await getCredential(env, "ns", "openai");
    expect(JSON.stringify(row)).not.toContain(SECRET_KEY);
    expect(row?.last4).toBe(SECRET_KEY.slice(-4));
    expect(row?.fingerprint).toBe((await sha256Hex(SECRET_KEY)).slice(0, 8));
    expect((await resolveApiKey(env, "ns", "openai"))?.key).toBe(SECRET_KEY);
  });

  it("returns null (never throws) for tampered rows and rows moved across namespaces", async () => {
    const env = makeEnv();
    await setCredential(env, "ns-a", "openai", SECRET_KEY);
    await setCredential(env, "ns-b", "openai", "sk-other-key-0123456789abcdef");
    invalidateKeyCache();
    const a = (await getCredential(env, "ns-a", "openai"))!;
    // Replay ns-a's sealed key under ns-b.
    db.raw
      .prepare(
        "UPDATE embedding_credentials SET ciphertext = ?, iv = ? WHERE namespace = 'ns-b'",
      )
      .run(a.ciphertext, a.iv);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resolveApiKey(env, "ns-b", "openai")).toBeNull();

    db.raw.exec(
      "UPDATE embedding_credentials SET ciphertext = 'AAAA' WHERE namespace = 'ns-a'",
    );
    invalidateKeyCache();
    expect(await resolveApiKey(env, "ns-a", "openai")).toBeNull();
  });

  it("revoke erases ciphertext and the key stops resolving immediately", async () => {
    const env = makeEnv();
    await setCredential(env, "ns", "openai", SECRET_KEY);
    expect(await resolveApiKey(env, "ns", "openai")).not.toBeNull();
    expect(await revokeCredential(env, "ns", "openai")).toBe(1);
    const row = await getCredential(env, "ns", "openai");
    expect(row?.status).toBe("revoked");
    expect(row?.ciphertext).toBeNull();
    expect(await resolveApiKey(env, "ns", "openai")).toBeNull();
  });

  it("marks the credential invalid after consecutive auth failures", async () => {
    const env = makeEnv();
    const { row } = (await setCredential(env, "ns", "openai", SECRET_KEY)) as {
      row: { credential_id: string };
    };
    for (let i = 0; i < AUTH_FAILURE_THRESHOLD; i++) {
      expect((await getCredential(env, "ns", "openai"))?.status).toBe("active");
      await recordAuthFailure(env, row.credential_id);
    }
    expect((await getCredential(env, "ns", "openai"))?.status).toBe("invalid");
    expect(await resolveApiKey(env, "ns", "openai")).toBeNull();
  });

  it("lazily re-wraps under a newer KEK on use", async () => {
    await setCredential(makeEnv(), "ns", "openai", SECRET_KEY);
    invalidateKeyCache();
    const rotated = makeEnv({ EMBEDDING_KEK_V2: kek2 });
    expect((await resolveApiKey(rotated, "ns", "openai"))?.key).toBe(
      SECRET_KEY,
    );
    expect((await getCredential(rotated, "ns", "openai"))?.kek_version).toBe(2);
    // V1 can be retired once swept.
    invalidateKeyCache();
    const v2Only = makeEnv({
      EMBEDDING_KEK_V1: undefined,
      EMBEDDING_KEK_V2: kek2,
    });
    expect((await resolveApiKey(v2Only, "ns", "openai"))?.key).toBe(SECRET_KEY);
  });

  it("loses the re-wrap race to a concurrent revoke instead of rewriting ciphertext", async () => {
    const env = makeEnv();
    await setCredential(env, "ns", "openai", SECRET_KEY);
    invalidateKeyCache();

    /**
     * Runs `concurrent` in the window between the row read and the re-wrap
     * UPDATE (on `bind`, immediately before the statement runs), so a revoke
     * landing in that window is deterministic instead of a timing race.
     */
    function revokingMidRewrap(concurrent: () => void): Env {
      const binding = env.DB as unknown as {
        prepare: (sql: string) => { bind: (...args: unknown[]) => unknown };
      };
      return {
        ...env,
        EMBEDDING_KEK_V2: kek2,
        DB: {
          ...binding,
          prepare: (sql: string) => {
            const statement = binding.prepare(sql);
            if (!/UPDATE embedding_credentials\s+SET ciphertext/.test(sql)) {
              return statement;
            }
            return new Proxy(statement, {
              get: (target, prop, receiver) => {
                if (prop !== "bind") return Reflect.get(target, prop, receiver);
                return (...args: unknown[]) => {
                  concurrent();
                  return target.bind(...args);
                };
              },
            });
          },
        },
      } as Env;
    }

    const rotated = revokingMidRewrap(() => {
      db.raw.exec(
        "UPDATE embedding_credentials SET status = 'revoked', ciphertext = NULL, iv = NULL WHERE namespace = 'ns'",
      );
    });

    // The key still opens: the row was active when it was read.
    expect((await resolveApiKey(rotated, "ns", "openai"))?.key).toBe(
      SECRET_KEY,
    );
    // The background re-wrap must not resurrect revoked ciphertext.
    const row = await getCredential(rotated, "ns", "openai");
    expect(row?.status).toBe("revoked");
    expect(row?.ciphertext).toBeNull();
    expect(row?.kek_version).toBe(1);
  });
});

describe("budget guard", () => {
  it("reserves atomically per pool and refuses once a pool is exhausted", async () => {
    const env = makeEnv({
      EMBEDDING_DAILY_BUDGET: "10",
      EMBEDDING_DAILY_QUERY_BUDGET: "4",
    });
    expect(await reserveBudget(env, "ns", 6, "index")).toBe(true);
    expect(await reserveBudget(env, "ns", 4, "index")).toBe(true);
    expect(await remainingBudget(env, "ns")).toBe(0);
    expect(await reserveBudget(env, "ns", 1, "index")).toBe(false);
    // Rejected reservations spend nothing; other namespaces are independent.
    expect(await remainingBudget(env, "ns")).toBe(0);
    expect(await reserveBudget(env, "other", 10, "index")).toBe(true);
    expect(await reserveBudget(env, "big", 11, "index")).toBe(false);
  });

  it("keeps search traffic from exhausting the pool import and reindex use", async () => {
    const env = makeEnv({
      EMBEDDING_DAILY_BUDGET: "10",
      EMBEDDING_DAILY_QUERY_BUDGET: "3",
    });
    for (let i = 0; i < 3; i++) {
      expect(await reserveBudget(env, "ns", 1, "query")).toBe(true);
    }
    // The query pool is spent; further searches degrade...
    expect(await reserveBudget(env, "ns", 1, "query")).toBe(false);
    expect(await remainingBudget(env, "ns", "query")).toBe(0);
    // ...but the write pool is untouched.
    expect(await remainingBudget(env, "ns", "index")).toBe(10);
    expect(await reserveBudget(env, "ns", 10, "index")).toBe(true);
    // And the reverse: an exhausted write pool leaves searches working.
    expect(await reserveBudget(env, "ns2", 10, "index")).toBe(true);
    expect(await reserveBudget(env, "ns2", 1, "index")).toBe(false);
    expect(await reserveBudget(env, "ns2", 1, "query")).toBe(true);
  });

  it("documents the defaults: 20000 write, 5000 query", async () => {
    const env = makeEnv();
    expect(await remainingBudget(env, "fresh", "index")).toBe(20_000);
    expect(await remainingBudget(env, "fresh", "query")).toBe(5_000);
  });

  it("counts a whole-pool request over the limit as refused without spending", async () => {
    const env = makeEnv({ EMBEDDING_DAILY_QUERY_BUDGET: "2" });
    expect(await reserveBudget(env, "ns", 3, "query")).toBe(false);
    expect(await remainingBudget(env, "ns", "query")).toBe(2);
  });

  it("fails closed when the database errors", async () => {
    const env = makeEnv({
      DB: {
        prepare: () => {
          throw new Error("d1 down");
        },
      } as unknown as Env["DB"],
    });
    await expect(reserveBudget(env, "ns", 1, "index")).rejects.toThrow();
  });
});
