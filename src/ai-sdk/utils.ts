import { createDiscoverSchemaTool } from "./tools/discover-schema.ts";
import { createExecuteSparqlTool } from "./tools/execute-sparql.ts";
import { createGenerateIriTool } from "./tools/generate-iri.ts";
import { createSearchEntitiesTool } from "./tools/search-entities.ts";
import type { CreateToolsOptions } from "./interfaces.ts";

/**
 * createTools creates a toolset from a CreateToolsOptions.
 */
export function createTools(options: CreateToolsOptions): {
  discoverSchema: ReturnType<typeof createDiscoverSchemaTool>;
  executeSparql: ReturnType<typeof createExecuteSparqlTool>;
  generateIri: ReturnType<typeof createGenerateIriTool>;
  searchEntities: ReturnType<typeof createSearchEntitiesTool>;
} {
  validateCreateToolsOptions(options);

  return {
    discoverSchema: createDiscoverSchemaTool(options),
    executeSparql: createExecuteSparqlTool(options),
    generateIri: createGenerateIriTool(options),
    searchEntities: createSearchEntitiesTool(options),
  };
}

/**
 * validateCreateToolsOptions enforces constraints on CreateToolsOptions.
 */
export function validateCreateToolsOptions(options: CreateToolsOptions) {
  if (options.sources.length === 0) {
    throw new Error("Sources must have at least one source.");
  }

  let writable = false;
  const seen = new Set<string>();
  for (const source of options.sources) {
    if (seen.has(source.id)) {
      throw new Error(`Duplicate source ID: ${source.id}`);
    }

    seen.add(source.id);

    if (source.writable) {
      if (writable) {
        throw new Error("Multiple writable sources are not allowed.");
      }

      writable = true;
    }
  }
}
