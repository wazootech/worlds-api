import type { WorldsOptions } from "#/sdk/mod.ts";

/**
 * CreateToolsOptions are the options for creating tools.
 */
export interface CreateToolsOptions extends WorldsOptions {
  /**
   * worldId is the ID of the world.
   */
  worldId: string;

  /**
   * generateIri is a function that generates an IRI for new entities.
   */
  generateIri?: () => string;
}
