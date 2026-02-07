import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { WorldsSdk } from "#/sdk/sdk.ts";
import type { CreateToolsOptions } from "#/ai-sdk/interfaces.ts";

/**
 * SearchEntitiesInput is the input to the searchEntities tool.
 */
export interface SearchEntitiesInput {
  query: string;
  limit?: number;
}

/**
 * searchEntitiesInputSchema is the input schema for the searchEntities tool.
 */
export const searchEntitiesInputSchema: z.ZodType<SearchEntitiesInput> = z
  .object({
    query: z.string().describe(
      "The text of the associated entity as mentioned in the given text.",
    ),
    limit: z.number().min(1).max(100).optional().describe(
      "Maximum number of entities to return (default: 10).",
    ),
  });

/**
 * SearchEntitiesOutput is the output of the searchEntities tool.
 */
export interface SearchEntitiesOutput {
  candidates: {
    iri: string;
    label?: string;
    description?: string;
    score: number;
  }[];
}

/**
 * searchEntitiesOutputSchema is the output schema for the searchEntities tool.
 */
export const searchEntitiesOutputSchema: z.ZodType<SearchEntitiesOutput> = z
  .object({
    candidates: z.array(
      z.object({
        iri: z.string().describe("The IRI of the candidate entity."),
        label: z.string().optional().describe("The label of the entity."),
        description: z.string().optional().describe(
          "A description or snippet for the entity.",
        ),
        score: z.number().describe("The search relevance score."),
      }),
    ).describe("A list of potential entity matches."),
  });

/**
 * createSearchEntitiesTool creates a tool that resolves entities by searching for facts.
 */
export function createSearchEntitiesTool(
  options: CreateToolsOptions,
): Tool<SearchEntitiesInput, SearchEntitiesOutput> {
  const sdk = new WorldsSdk(options);
  return tool({
    description:
      "Search for entities in the knowledge base. Returns a list of candidates to help resolve ambiguities.",
    inputSchema: searchEntitiesInputSchema,
    outputSchema: searchEntitiesOutputSchema,
    execute: async (
      { query, limit }: SearchEntitiesInput,
    ): Promise<SearchEntitiesOutput> => {
      const worldIds = options.sources
        .filter((source) => !source.schema)
        .map((source) => source.id);
      const searchResults = await sdk.worlds.search(query, {
        worldIds,
        limit: limit ?? 5, // Default to top 5 candidates
      });

      return {
        candidates: searchResults.map((result) => ({
          iri: result.subject,
          label: result.object, // Assuming object often contains the label/text match
          score: result.score,
        })),
      };
    },
  });
}
