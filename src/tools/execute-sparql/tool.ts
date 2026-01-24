import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { SparqlResult } from "#/sdk/types.ts";
import { Worlds } from "#/sdk/worlds.ts";
import type { CreateToolsOptions } from "#/tools/types.ts";

/**
 * createExecuteSparqlTool creates a tool that executes SPARQL queries and updates.
 */
export function createExecuteSparqlTool(
  options: CreateToolsOptions,
): Tool<{
  sparql: string;
  worldId: string;
}, SparqlResult | null> {
  const worlds = new Worlds(options);
  return tool({
    description:
      `Execute SPARQL queries and updates against a specific world knowledge base. This tool provides direct access to RDF data for reading, writing, and modifying facts.

Capabilities:
- Query data: SELECT, ASK, CONSTRUCT, DESCRIBE to explore existing facts and schema
- Insert facts: INSERT DATA, INSERT {} to add new information
- Delete facts: DELETE DATA, DELETE {} to remove obsolete information
- Update data: Combine INSERT and DELETE for modifications
- Supports: SELECT, ASK, CONSTRUCT, DESCRIBE, INSERT, DELETE, LOAD, CLEAR

You MUST provide the worldId parameter specifying which world to query. If you don't know which worldId contains the data you need, first use searchFacts to find relevant facts. The search results include 'worldId' fields that identify which worlds contain matching data—use those worldIds here to execute your SPARQL operations.`,
    inputSchema: z.object({
      sparql: z.string().describe("The SPARQL query or update to execute."),
      worldId: z.string().describe(
        "The ID of the world to execute the query against.",
      ),
    }),
    execute: async ({ sparql, worldId }) => {
      return await worlds.sparql(worldId, sparql);
    },
  });
}
