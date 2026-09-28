import { describe, expect, it, vi } from "vitest";
import app from "../src/app";
import worker from "../src/index";

describe("cutover maintenance", () => {
  it("rejects API traffic while maintenance is enabled", async () => {
    const response = await app.request("/health", {}, {
      CUTOVER_MAINTENANCE: "true",
    } as any);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "MAINTENANCE",
        message: "Cutover maintenance in progress",
      },
    });
  });

  it("skips scheduled database work while maintenance is enabled", async () => {
    const waitUntil = vi.fn();

    await worker.scheduled({}, { CUTOVER_MAINTENANCE: "true" }, { waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
  });
});
