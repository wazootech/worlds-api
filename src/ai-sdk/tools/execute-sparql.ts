import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { WorldsSdk } from "#/sdk/sdk.ts";
import {
  type ExecuteSparqlOutput,
  executeSparqlOutputSchema,
} from "#/sdk/worlds/schema.ts";
import type { CreateToolsOptions } from "#/ai-sdk/interfaces.ts";
import { isSparqlUpdate } from "#/sdk/utils.ts";

// Re-export the output schema and type from the SDK.
export { type ExecuteSparqlOutput, executeSparqlOutputSchema };

/**
 * ExecuteSparqlInput is the input to the executeSparql tool.
 */
export interface ExecuteSparqlInput {
  source: string;
  sparql: string;
}

/**
 * executeSparqlInputSchema is the input schema for the executeSparql tool.
 */
export const executeSparqlInputSchema: z.ZodType<ExecuteSparqlInput> = z.object(
  {
    source: z.string().describe(
      "The ID of the source to execute the query against.",
    ),
    sparql: z.string().describe("The SPARQL query or update to execute."),
  },
);

/**
 * createExecuteSparqlTool creates a tool that executes SPARQL queries and updates.
 */
export function createExecuteSparqlTool(
  options: CreateToolsOptions,
): Tool<ExecuteSparqlInput, ExecuteSparqlOutput> {
  const sdk = new WorldsSdk(options);
  return tool({
    description:
      "Execute SPARQL queries and updates against a specific world knowledge base.",
    inputSchema: executeSparqlInputSchema,
    outputSchema: executeSparqlOutputSchema,
    execute: async ({ sparql, source }) => {
      // Validate write permissions for update queries.
      if (
        isSparqlUpdate(sparql) &&
        !options.sources.find((s) => s.id === source)?.writable
      ) {
        throw new Error(
          "Write operations are disabled. This source is configured as read-only. " +
            "Only SELECT, ASK, CONSTRUCT, and DESCRIBE queries are allowed.",
        );
      }

      return await sdk.worlds.sparql(source, sparql);
    },
  });
}
