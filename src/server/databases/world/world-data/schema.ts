import { z } from "zod";

/**
 * worldDataSchema represents the singleton world data record.
 */
export const worldDataSchema = z.object({
  blob: z.union([
    z.instanceof(Uint8Array),
    z.instanceof(ArrayBuffer).transform((ab) => new Uint8Array(ab)),
  ]).nullable(),
  updated_at: z.number(),
});

export type WorldData = z.infer<typeof worldDataSchema>;
