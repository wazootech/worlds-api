import { describe, expect, it, vi } from "vitest";
import {
  env,
  FULL_TOKEN,
  getWorldSdkMock,
  request,
  useAbuseMocks,
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
  uid: vi.fn(() => "mock-uid"),
  newWorldId: vi.fn(() => "w_00000000000000000000000001"),
  now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

useAbuseMocks();

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the per-key bucket is exhausted", async () => {
    const prevRpm = env.RATE_LIMIT_RPM;
    const prevBurst = env.RATE_LIMIT_BURST;
    env.RATE_LIMIT_RPM = "60";
    env.RATE_LIMIT_BURST = "2";
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await request("rate-limit-test-token", "/worlds", {
          method: "GET",
        });
        statuses.push(res.status);
      }
      // Bucket of 2: first request seeds it, next two consume, fourth is limited.
      expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
      expect(statuses[3]).toBe(429);

      const limited = await request("rate-limit-test-token", "/worlds", {
        method: "GET",
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBeTruthy();
      const body = (await limited.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("RATE_LIMITED");
    } finally {
      env.RATE_LIMIT_RPM = prevRpm;
      env.RATE_LIMIT_BURST = prevBurst;
    }
  });

  it("exempts the health endpoint from rate limiting", async () => {
    const prevRpm = env.RATE_LIMIT_RPM;
    const prevBurst = env.RATE_LIMIT_BURST;
    env.RATE_LIMIT_RPM = "60";
    env.RATE_LIMIT_BURST = "1";
    try {
      for (let i = 0; i < 5; i += 1) {
        const res = await request(null, "/health", { method: "GET" });
        expect(res.status).toBe(200);
      }
    } finally {
      env.RATE_LIMIT_RPM = prevRpm;
      env.RATE_LIMIT_BURST = prevBurst;
    }
  });
});

describe("import caps", () => {
  it("rejects a JSON import above the per-request quad cap with 413", async () => {
    const quads = Array.from({ length: 11 }, (_, i) => ({
      subject: `urn:s${i}`,
      predicate: "urn:p",
      object: `urn:o${i}`,
    }));
    const res = await request(
      FULL_TOKEN,
      "/worlds/w_00000000000000000000000001/import",
      {
        method: "POST",
        body: JSON.stringify({
          contentType: "application/json",
          data: JSON.stringify(quads),
        }),
      },
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects a plain-text import above the chunk cap with 413", async () => {
    const lines = Array.from({ length: 11 }, (_, i) => `chunk ${i}`);
    const res = await request(
      FULL_TOKEN,
      "/worlds/w_00000000000000000000000001/import",
      {
        method: "POST",
        body: JSON.stringify({
          contentType: "text/plain",
          data: lines.join("\n"),
        }),
      },
    );
    expect(res.status).toBe(413);
  });
});

describe("SPARQL guards", () => {
  it("rejects queries above the length cap before touching the engine", async () => {
    const res = await request(
      FULL_TOKEN,
      "/worlds/w_00000000000000000000000001/sparql",
      {
        method: "POST",
        body: JSON.stringify({
          query: "SELECT * WHERE { ?s ?p ?o } ".repeat(20),
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("QUERY_TOO_LARGE");
    expect(getWorldSdkMock).not.toHaveBeenCalled();
  });
});
