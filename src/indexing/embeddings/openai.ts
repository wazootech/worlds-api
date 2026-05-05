import type { EmbeddingsService } from "./interface.ts";

export interface OpenAIEmbeddingsConfig {
  /**
   * The OpenAI API key.
   * If not provided, it will attempt to use the `OPENAI_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
   * The model to use. Defaults to `text-embedding-3-small`.
   */
  model?: string;

  /**
   * The dimension size of the generated embeddings. Defaults to `1536` for `text-embedding-3-small`.
   */
  dimensions?: number;

  /**
   * The base URL for the OpenAI API. Defaults to `https://api.openai.com/v1`.
   */
  baseUrl?: string;
}

export class OpenAIEmbeddingsService implements EmbeddingsService {
  public readonly dimensions: number;
  private readonly apiKey: string;
  public readonly model: string;
  private readonly baseUrl: string;

  constructor(config?: OpenAIEmbeddingsConfig) {
    this.apiKey = config?.apiKey || Deno.env.get("OPENAI_API_KEY") || "";
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required");
    }
    this.model = config?.model || "text-embedding-3-small";
    this.dimensions = config?.dimensions || 1536;
    this.baseUrl = config?.baseUrl || "https://api.openai.com/v1";
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const BATCH_LIMIT = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_LIMIT) {
      const batch = texts.slice(i, i + BATCH_LIMIT);
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: batch,
          model: this.model,
          dimensions: this.dimensions,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${error}`);
      }

      const data = await response.json();
      const embeddings = data.data.map((item: { embedding: number[] }) =>
        item.embedding
      );
      results.push(...embeddings);
    }

    return results;
  }
}
