import { describe, expect, it } from "vitest";
import app from "../src/app";

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("POST /worlds/:id/reindex endpoint", () => {
  it("rejects request without authorization token", async () => {
    const res = await app.request(
      "/worlds/test-world/reindex",
      { method: "POST" },
      {},
      executionCtx,
    );
    expect(res.status).toBe(401);
  });
});
