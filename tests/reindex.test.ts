import { describe, expect, it } from "vitest";
import app from "../src/app";

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("POST /worlds/:worldId/reindex endpoint", () => {
  it("rejects request without authorization token", async () => {
    const res = await app.request(
      "/worlds/w_00000000-0000-4000-8000-000000000001/reindex",
      { method: "POST" },
      {},
      executionCtx,
    );
    expect(res.status).toBe(401);
  });
});
