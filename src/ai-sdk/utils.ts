import type { CreateToolsOptions } from "./interfaces.ts";

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
