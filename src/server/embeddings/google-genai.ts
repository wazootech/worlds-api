import type { GoogleGenAI } from "@google/genai";
import type { Embeddings } from "#/server/embeddings/embeddings.ts";

/**
 * GoogleGenAIEmbeddingsOptions are options for the GoogleGenAIEmbeddings.
 */
export interface GoogleGenAIEmbeddingsOptions {
  /**
   * client is the GoogleGenAI client.
   */
  client: GoogleGenAI;

  /**
   * model is the model to use for embedding.
   */
  model: string;

  /**
   * dimensions is the dimensionality of the vector embeddings.
   */
  dimensions: number;
}

/**
 * GoogleGenAIEmbeddings generates vector embeddings using Google GenAI.
 */
export class GoogleGenAIEmbeddings implements Embeddings {
  public constructor(private readonly options: GoogleGenAIEmbeddingsOptions) {}

  /**
   * dimensions is the dimensionality of the vector embeddings.
   */
  public get dimensions(): number {
    return this.options.dimensions;
  }

  /**
   * embed generates a vector embedding for a given text.
   */
  public async embed(text: string): Promise<number[]> {
    const response = await this.options.client.models.embedContent({
      model: this.options.model,
      contents: [{ parts: [{ text }] }],
      config: {
        outputDimensionality: this.options.dimensions,
      },
    });
    if (!response.embeddings?.[0]?.values) {
      throw new Error("Failed to generate embedding");
    }

    return response.embeddings[0].values;
  }
}
