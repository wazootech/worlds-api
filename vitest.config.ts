import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Prevent vitest from following @worlds/cloudflare source files into
      // worlds-cloudflare's own node_modules (which have Deno-style imports
      // that Node can't resolve). Point at a lightweight stub instead.
      "@worlds/cloudflare": resolve(__dirname, "src/types/worlds-cloudflare.d.ts"),
      "@worlds/sdk": resolve(__dirname, "src/types/worlds-cloudflare.d.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text-summary", "text"],
      // Floors are the measured coverage (2026-10-28) rounded down. Raise
      // them as coverage grows; never lower them to land a change.
      thresholds: {
        lines: 83,
        functions: 86,
        branches: 73,
        statements: 81,
      },
    },
  },
});
