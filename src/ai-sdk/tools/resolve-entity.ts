import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { SearchResult } from "#/sdk/worlds/schema.ts";
import { WorldsSdk } from "#/sdk/sdk.ts";
import type { CreateToolsOptions } from "#/ai-sdk/interfaces.ts";

/**
 * ResolveEntityInput is the input to the resolveEntity tool.
 */
export interface ResolveEntityInput {
  referenceText: string;
  limit?: number;
}

/**
 * resolveEntityInputSchema is the input schema for the resolveEntity tool.
 */
export const resolveEntityInputSchema: z.ZodType<ResolveEntityInput> = z
  .object({
    referenceText: z.string().describe(
      "The text of the associated entity as mentioned in the given text.",
    ),
    limit: z.number().min(1).max(100).optional().describe(
      "Maximum number of entities to return (default: 10).",
    ),
  });

/**
 * ResolveEntityOutput is the output of the resolveEntity tool.
 */
export interface ResolveEntityOutput {
  score: number;
  iri: string;
}

/**
 * resolveEntityOutputSchema is the output schema for the resolveEntity tool.
 */
export const resolveEntityOutputSchema: z.ZodType<ResolveEntityOutput> = z
  .object({
    score: z.number().describe("The score of the result."),
    iri: z.string().describe("The IRI of the resolved entity."),
  });

/**
 * createResolveEntityTool creates a tool that resolves entities by searching for facts.
 */
export function createResolveEntityTool(
  options: CreateToolsOptions,
): Tool<ResolveEntityInput, ResolveEntityOutput> {
  const sdk = new WorldsSdk(options);
  const disambiguate = options.disambiguate ??
    ((results: SearchResult[]) => results[0]);
  return tool({
    description: "Search for entities in the knowledge base.",
    inputSchema: resolveEntityInputSchema,
    outputSchema: resolveEntityOutputSchema,
    execute: async ({ referenceText, limit }) => {
      const worldIds = options.sources
        .filter((source) => !source.schema)
        .map((source) => source.id);
      const searchResults = await sdk.worlds.search(referenceText, {
        worldIds,
        limit: limit ?? 10,
      });

      const searchResult = await disambiguate(searchResults);
      return {
        score: searchResult.score,
        iri: searchResult.value.subject,
      };
    },
  });
}
