import { describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { sha256Hex } from "../src/lib/crypto";
import { requireAccess } from "../src/lib/auth";
import { requireWorldAccess, type WorldRow } from "../src/routes/worlds/shared";
import { createApiKeyDb } from "./helpers/api-key-db";
import {
  FULL_TOKEN,
  getWorldSdkMock,
  request,
  resolveWorldDatabaseMock,
  useAbuseMocks,
  worldRef,
} from "./helpers/abuse-harness";

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));
vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

useAbuseMocks();

const failures = [
  {
    reason: "namespace mismatch before world or scope mismatch",
    namespace: "other-namespace",
    worldId: "other-world",
    scopes: [],
    query: "ASK { ?s ?p ?o }",
    message: "This API key belongs to a different namespace",
  },
  {
    reason: "world mismatch before scope mismatch",
    namespace: "ns",
    worldId: "other-world",
    scopes: [],
    query: "ASK { ?s ?p ?o }",
    message: "This API key is scoped to a different world",
  },
  {
    reason: "missing read scope",
    namespace: "ns",
    worldId: worldRef.worldId,
    scopes: ["data:write"],
    query: "ASK { ?s ?p ?o }",
    message: "This API key does not have the 'data:read' scope",
  },
  {
    reason: "missing write scope",
    namespace: "ns",
    worldId: worldRef.worldId,
    scopes: ["data:read"],
    query: "DELETE WHERE { ?s ?p ?o }",
    message: "This API key does not have the 'data:write' scope",
  },
];

describe("authenticated FORBIDDEN responses", () => {
  it.each(failures)("identifies $reason", async (failure) => {
    vi.mocked(getDb).mockReturnValue(
      createApiKeyDb({
        [await sha256Hex(FULL_TOKEN)]: {
          namespace: failure.namespace,
          world_id: failure.worldId,
          scopes: JSON.stringify(failure.scopes),
        },
      }) as never,
    );

    const res = await request(
      FULL_TOKEN,
      `/worlds/${worldRef.worldId}/sparql`,
      { method: "POST", body: JSON.stringify({ query: failure.query }) },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: failure.message },
    });
    expect(getWorldSdkMock).not.toHaveBeenCalled();
  });

  it.each(failures)(
    "identifies $reason on metadata access",
    async (failure) => {
      const res = requireWorldAccess(
        {
          admin: false,
          namespace: failure.namespace,
          worldId: failure.worldId,
          scopes: failure.scopes,
        },
        { namespace: worldRef.namespace } as WorldRow,
        worldRef.worldId,
        failure.query.startsWith("DELETE") ? "data:write" : "data:read",
      );
      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({
        error: { code: "FORBIDDEN", message: failure.message },
      });
    },
  );

  it("keeps metadata access unauthenticated without a namespace", async () => {
    const res = requireWorldAccess(
      { admin: false },
      { namespace: worldRef.namespace } as WorldRow,
      worldRef.worldId,
      "data:read",
    );
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
    });
  });

  it.each([
    { admin: false },
    { admin: false, namespace: "ns", scopes: ["data:read"] },
    {
      admin: false,
      namespace: "ns",
      worldId: worldRef.worldId,
      scopes: ["data:read"],
    },
  ])("rejects an empty world ID with a generic 401 for %j", async (auth) => {
    const res = requireWorldAccess(
      auth,
      { namespace: worldRef.namespace } as WorldRow,
      "",
      "data:read",
    );
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
    });
  });

  it("preserves admin bypass for an empty world ID", () => {
    expect(requireAccess({ admin: true }, "ns", "", "data:read")).toBeNull();
  });

  it.each([true, false])(
    "allows an omitted world ID for namespace access (admin: %s)",
    (admin) => {
      expect(
        requireAccess(
          { admin, namespace: "ns", scopes: ["data:read"] },
          "ns",
          undefined,
          "data:read",
        ),
      ).toBeNull();
    },
  );

  it.each([null, "invalid-token"])(
    "keeps the generic 401 for token %s",
    async (token) => {
      const res = await request(token, `/worlds/${worldRef.worldId}/sparql`, {
        method: "POST",
        body: JSON.stringify({ query: "ASK { ?s ?p ?o }" }),
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
      });
      expect(resolveWorldDatabaseMock).not.toHaveBeenCalled();
      expect(getWorldSdkMock).not.toHaveBeenCalled();
    },
  );
});
