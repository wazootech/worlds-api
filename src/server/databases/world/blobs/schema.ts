import { z } from "zod";

/**
 * blobSchema represents the singleton blob record.
 */
export const blobSchema = z.object({
  blob: z.union([
    z.instanceof(Uint8Array),
    z.instanceof(ArrayBuffer).transform((ab) => new Uint8Array(ab)),
  ]).nullable(),
  updated_at: z.number(),
});

export type BlobRow = z.infer<typeof blobSchema>;
