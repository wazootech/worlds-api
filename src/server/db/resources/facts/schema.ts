import { z } from "zod";

/**
 * factTableSchema is the Zod schema for the facts database table.
 * This represents the raw database row structure including the vector.
 */
export const factTableSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  property: z.string(),
  value: z.string(),
  vector: z
    .union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)])
    .nullable(),
});

/**
 * FactTable represents a fact record as stored in the database.
 */
export type FactTable = z.infer<typeof factTableSchema>;

/**
 * factRowSchema is the Zod schema for a fact record as returned by search queries.
 * This omits the large vector field for performance.
 */
export const factRowSchema = factTableSchema.omit({
  vector: true,
});

/**
 * FactRow represents a fact record without the vector field.
 */
export type FactRow = z.infer<typeof factRowSchema>;

/**
 * factTableUpsertSchema is the Zod schema for inserting or replacing a fact.
 */
export const factTableUpsertSchema = factTableSchema;

/**
 * FactTableUpsert represents the data needed to upsert a fact.
 */
export type FactTableUpsert = z.infer<
  typeof factTableUpsertSchema
>;
