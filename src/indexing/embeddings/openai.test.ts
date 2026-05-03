import { assertEquals, assertThrows } from "@std/assert";
import { OpenAIEmbeddingsService } from "./openai.ts";

Deno.test("OpenAIEmbeddingsService: initialization", () => {
  const service = new OpenAIEmbeddingsService({ apiKey: "test-key" });
  assertEquals(service.dimensions, 1536);
});

Deno.test("OpenAIEmbeddingsService: requires API key", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  try {
    const original = Deno.env.get("OPENAI_API_KEY");
    if (original !== undefined) {
      Deno.env.delete("OPENAI_API_KEY");
    }

    try {
      assertThrows(
        () => new OpenAIEmbeddingsService(),
        Error,
        "OpenAI API key is required",
      );
    } finally {
      if (original !== undefined) {
        Deno.env.set("OPENAI_API_KEY", original);
      }
    }
  } catch (e) {
    // Ignore permission errors — test will be skipped
    if (e instanceof Error && e.message.includes("permission")) {
      console.log("Skipping test: --allow-env permission required");
      return;
    }
    throw e;
  }
});
