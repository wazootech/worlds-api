import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import {
  countOrganizationDatabases,
  DatabaseLimitError,
  DEFAULT_MAX_DATABASES,
  maxDatabases,
  provisionWorldDatabase,
} from "../src/lib/turso";

const baseEnv = {
  TURSO_ORG: "test-org",
  TURSO_GROUP: "test-group",
  TURSO_PLATFORM_API_TOKEN: "test-token",
  WAZOO_ENV: "test",
} as unknown as Env;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("maxDatabases", () => {
  it("defaults to 100", () => {
    expect(maxDatabases(baseEnv)).toBe(DEFAULT_MAX_DATABASES);
  });

  it("honors MAX_DATABASES env", () => {
    expect(maxDatabases({ ...baseEnv, MAX_DATABASES: "250" } as Env)).toBe(250);
  });

  it("falls back to the default on garbage input", () => {
    expect(maxDatabases({ ...baseEnv, MAX_DATABASES: "abc" } as Env)).toBe(
      DEFAULT_MAX_DATABASES,
    );
  });
});

describe("countOrganizationDatabases", () => {
  it("counts databases across pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ databases: [1, 2, 3], next_page_token: "p2" }),
      )
      .mockResolvedValueOnce(jsonResponse({ databases: [4, 5] }));
    vi.stubGlobal("fetch", fetchMock);

    const count = await countOrganizationDatabases(baseEnv);
    expect(count).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("provisionWorldDatabase capacity guard", () => {
  it("throws DatabaseLimitError when the org is at capacity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ databases: new Array(100) })),
    );

    await expect(provisionWorldDatabase(baseEnv, "w_x")).rejects.toBeInstanceOf(
      DatabaseLimitError,
    );
  });

  it("maps Turso's own limit rejection to DatabaseLimitError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ databases: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "maximum database count of 100 reached" }, 400),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(provisionWorldDatabase(baseEnv, "w_x")).rejects.toBeInstanceOf(
      DatabaseLimitError,
    );
  });
});
