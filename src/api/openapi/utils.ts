import type { OpenAPIV3_1 } from "openapi-types";
import { expandGlob } from "@std/fs/expand-glob";

/**
 * importGlob imports a glob of files and returns an array of modules.
 */
export async function importGlob(glob: URL) {
  return await Array.fromAsync(expandGlob(glob), async (entry) => {
    const path = entry.path;
    if (!path) return null;
    return await import(new URL(`file:///${path}`).href);
  }).then((modules) => modules.filter((m): m is NonNullable<typeof m> => m !== null));
}

/**
 * collectPathItems collects path items from an array of modules.
 */
export function collectPathItems(
  modules: Array<{ default: Record<string, OpenAPIV3_1.PathItemObject> }>,
): Record<string, OpenAPIV3_1.PathItemObject> {
  return modules.reduce((acc, curr) => {
    return { ...acc, ...(curr.default ?? curr) };
  }, {});
}

/**
 * collectSchemas collects schemas from an array of modules.
 */
export function collectSchemas(
  modules: Array<{ default: Record<string, OpenAPIV3_1.SchemaObject> }>,
): Record<string, OpenAPIV3_1.SchemaObject> {
  return modules.reduce((acc, curr) => {
    return { ...acc, ...(curr.default ?? curr) };
  }, {});
}
