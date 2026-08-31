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
  },
});
