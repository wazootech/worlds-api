import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { WorldsSdk } from "#/sdk/sdk.ts";
import type { CreateToolsOptions } from "#/ai-sdk/interfaces.ts";

// TODO: Consider rename to resolve-schema.ts

/**
 * DiscoverSchemaInput is the input to the discoverSchema tool.
 */
export interface DiscoverSchemaInput {
  referenceText: string;
  limit?: number;
}

/**
 * discoverSchemaInputSchema is the input schema for the discoverSchema tool.
 */
export const discoverSchemaInputSchema: z.ZodType<DiscoverSchemaInput> = z
  .object({
    referenceText: z.string().describe(
      "A natural language description of the entities or properties to discover (e.g., 'A person with a name').",
    ),
    limit: z.number().min(1).max(100).optional().describe(
      "Maximum number of unique subjects to return (default: 10).",
    ),
  });

/**
 * SchemaConcept represents an RDF class, property, or context dimension.
 */
export interface SchemaConcept {
  iri: string;
  label?: string;
  kind: "Class" | "Property" | "ContextDimension" | "Unknown";
  description?: string;
  domain?: string;
  range?: string;
}

/**
 * DiscoverSchemaOutput is the output of the discoverSchema tool.
 */
export interface DiscoverSchemaOutput {
  concepts: SchemaConcept[];
}

// TODO: Carefully design this tool schema because it is what i will base the next search documents table on.

/**
 * discoverSchemaOutputSchema is the output schema for the discoverSchema tool.
 */
export const discoverSchemaOutputSchema: z.ZodType<DiscoverSchemaOutput> = z
  .object({
    concepts: z.array(
      z.object({
        iri: z.string().describe("The IRI of the discovered schema element."),
        label: z.string().optional().describe(
          "The human-readable label of the element.",
        ),
        kind: z.enum(["Class", "Property", "ContextDimension", "Unknown"])
          .describe("The kind of schema element."),
        description: z.string().optional().describe(
          "A description of the element.",
        ),
        domain: z.string().optional().describe(
          "The domain of the property (if applicable).",
        ),
        range: z.string().optional().describe(
          "The range of the property (if applicable).",
        ),
      }),
    ),
  });

/**
 * createDiscoverSchemaTool creates a tool that discovers RDF classes, properties, and contextual dimensions.
 */
export function createDiscoverSchemaTool(
  options: CreateToolsOptions,
): Tool<DiscoverSchemaInput, DiscoverSchemaOutput> {
  const sdk = new WorldsSdk(options);
  return tool({
    description:
      "Discover the available classes and properties (vocabulary) in the knowledge base schema.",
    inputSchema: discoverSchemaInputSchema,
    outputSchema: discoverSchemaOutputSchema,
    execute: async ({ referenceText, limit }) => {
      const worldIds = options.sources
        .filter((source) => source.schema)
        .map((source) => source.id);

      if (worldIds.length === 0) {
        return { concepts: [] };
      }

      // Search for triples in schema worlds, explicitly looking for potential subjects using the reference text.
      const searchResults = await sdk.worlds.search(referenceText, {
        worldIds,
        limit: (limit ?? 10) * 2, // Fetch a few more to filter/group
      });

      // Identify unique potential subjects and their source worlds.
      const subjectMap = new Map<string, string>(); // IRI -> worldId
      for (const result of searchResults) {
        // We prioritize results where the subject matches our search, or the object matches (label search)
        // For simplicity, we take the subject of any matching triple as a candidate concept.
        const subject = result.subject;
        if (!subjectMap.has(subject) && result.worldId) {
          subjectMap.set(subject, result.worldId);
        }

        if (subjectMap.size >= (limit ?? 10)) break;
      }

      // Hydrate concepts using SPARQL queries to fetch full properties.
      // We run a query for each subject to get its full properties.
      // To optimize, we group by worldId and use VALUES or just loop if N is small.
      // Since N is small (limit=10), parallel requests are fine.
      const concepts: SchemaConcept[] = [];

      await Promise.all(
        Array.from(subjectMap.entries()).map(async ([iri, worldId]) => {
          try {
            const query = `
              SELECT ?p ?o WHERE {
                { <${iri}> ?p ?o . }
                UNION
                { <${iri}> rdfs:subClassOf* ?parent . ?parent ?p ?o . }
                UNION
                { <${iri}> owl:equivalentClass ?equiv . ?equiv ?p ?o . }
              }
            `;
            const output = await sdk.worlds.sparql(worldId, query);
            if (!output || !output.results) return;

            // Ensure it's a SELECT result with bindings (not quads)
            if (!("bindings" in output.results)) return;

            const concept: SchemaConcept = {
              iri,
              kind: "Unknown",
            };

            for (const binding of output.results.bindings) {
              const p = binding.p.value;
              const o = binding.o.value;

              if (
                p === "http://www.w3.org/2000/01/rdf-schema#label" ||
                p === "http://www.w3.org/2004/02/skos/core#prefLabel"
              ) {
                concept.label = o;
              } else if (
                p === "http://www.w3.org/2000/01/rdf-schema#comment" ||
                p === "http://www.w3.org/2004/02/skos/core#definition"
              ) {
                concept.description = o;
              } else if (
                p === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
              ) {
                if (
                  o === "http://www.w3.org/2000/01/rdf-schema#Class" ||
                  o === "http://www.w3.org/2002/07/owl#Class"
                ) {
                  concept.kind = "Class";
                } else if (
                  o ===
                    "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property" ||
                  o === "http://www.w3.org/2002/07/owl#ObjectProperty" ||
                  o === "http://www.w3.org/2002/07/owl#DatatypeProperty"
                ) {
                  concept.kind = "Property";
                }
              } else if (
                p === "http://www.w3.org/2000/01/rdf-schema#subClassOf"
              ) {
                // If it's a subclass of something, it's a Class.
                concept.kind = "Class";
              } else if (
                p === "http://www.w3.org/2000/01/rdf-schema#domain"
              ) {
                concept.domain = o;
              } else if (
                p === "http://www.w3.org/2000/01/rdf-schema#range"
              ) {
                concept.range = o;
              }
            }
            concepts.push(concept);
          } catch (e) {
            console.warn(`Failed to hydrate concept ${iri}:`, e);
            // Optionally include partial info from search result?
            // For now, allow skipping if SPARQL fails (e.g., restricted access).
          }
        }),
      );

      return {
        concepts,
      };
    },
  });
}
