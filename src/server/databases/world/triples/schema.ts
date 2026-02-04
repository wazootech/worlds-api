import { z } from "zod";

/**
 * tripleTableSchema is the Zod schema for the triples database table.
 * This represents the raw database row structure including the vector.
 */
export const tripleTableSchema = z.object({
  id: z.string(),
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  vector: z
    .union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)])
    .nullable(),
});

/**
 * TripleTable represents a triple record as stored in the database.
 */
export type TripleTable = z.infer<typeof tripleTableSchema>;

/**
 * tripleRowSchema is the Zod schema for a triple record as returned by search queries.
 * This omits the large vector field for performance.
 */
export const tripleRowSchema = tripleTableSchema.omit({
  vector: true,
});

/**
 * TripleRow represents a triple record without the vector field.
 */
export type TripleRow = z.infer<typeof tripleRowSchema>;

/**
 * tripleTableUpsertSchema is the Zod schema for inserting or replacing a triple.
 */
export const tripleTableUpsertSchema = tripleTableSchema;

/**
 * TripleTableUpsert represents the data needed to upsert a triple.
 */
export type TripleTableUpsert = z.infer<
  typeof tripleTableUpsertSchema
>;
