import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { isOriginAllowed } from "../src/lib/abuse/origins";

const preview = "https://pr-previews.preview.console.wazoo.dev";
const asEnv = (e: Partial<Env>) => e as Env;

describe("isOriginAllowed", () => {
  it("allows the console and localhost in every env", () => {
    for (const WAZOO_ENV of ["prod", "qa", undefined]) {
      for (const o of ["https://console.wazoo.dev", "http://localhost:3000"]) {
        expect(isOriginAllowed(o, asEnv({ WAZOO_ENV }))).toBe(true);
      }
    }
  });

  it("allows console preview origins on QA only", () => {
    expect(isOriginAllowed(preview, asEnv({ WAZOO_ENV: "qa" }))).toBe(true);
    expect(isOriginAllowed(preview, asEnv({ WAZOO_ENV: "prod" }))).toBe(false);
    expect(isOriginAllowed(preview, asEnv({}))).toBe(false);
  });

  it("no longer trusts the account-wide workers.dev subdomain", () => {
    const qa = asEnv({ WAZOO_ENV: "qa" });
    for (const o of [
      "https://ethan-r-davidson.workers.dev",
      "https://anything.ethan-r-davidson.workers.dev",
      "https://wazoo-console-preview.ethan-r-davidson.workers.dev",
    ]) {
      expect(isOriginAllowed(o, qa)).toBe(false);
    }
  });

  it("denies lookalikes and an explicit CORS_ORIGINS list overrides defaults", () => {
    const qa = asEnv({ WAZOO_ENV: "qa" });
    for (const o of [
      "http://pr-previews.preview.console.wazoo.dev",
      "https://pr-previews.preview.console.wazoo.dev.evil.com",
      "https://a.b.preview.console.wazoo.dev",
      "https://evil.wazoo.dev",
    ]) {
      expect(isOriginAllowed(o, qa)).toBe(false);
    }
    const configured = asEnv({
      WAZOO_ENV: "qa",
      CORS_ORIGINS: "https://only.example.com",
    });
    expect(isOriginAllowed("https://only.example.com", configured)).toBe(true);
    expect(isOriginAllowed(preview, configured)).toBe(false);
  });
});
