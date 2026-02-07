import type { Source, WorldsSdkOptions } from "#/sdk/interfaces.ts";
// import type { SearchResult } from "#/sdk/worlds/schema.ts";

/**
 * CreateToolsOptions is the options for the createTools function.
 */
export interface CreateToolsOptions extends WorldsSdkOptions {
  /**
   * sources is the list of sources visible to the tools.
   */
  sources: Source[];

  // /**
  //  * disambiguate is a function that disambiguates between multiple entities.
  //  */
  // disambiguate?: (
  //   results: SearchResult[],
  // ) => SearchResult | Promise<SearchResult>;

  /**
   * generateIri is a function that generates an IRI for new entities.
   */
  generateIri?: () => string | Promise<string>;
}

// /**
//  * Disambiguator is a function that disambiguates between multiple entities.
//  */
// export type Disambiguator = (entities: Entity[]) => Entity;
