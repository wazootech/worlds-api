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
}, SparqlResult | null> {
  const worlds = new Worlds(options);
  const { worldId } = options;
  return tool({
    description: `Execute a SPARQL query or update against the knowledge base.
Use this tool to:
- Research existing data and schema structure (SELECT, ASK, CONSTRUCT, DESCRIBE)
- Insert new facts (INSERT DATA, INSERT {})
- Delete obsolete facts (DELETE DATA, DELETE {})
- Update information
- Supports: SELECT, ASK, CONSTRUCT, DESCRIBE, INSERT, DELETE, LOAD, CLEAR
`,
    inputSchema: z.object({
      sparql: z.string().describe("The SPARQL query or update to execute."),
    }),
    execute: async ({ sparql }) => {
      return await worlds.sparql(worldId, sparql);
    },
  });
}
