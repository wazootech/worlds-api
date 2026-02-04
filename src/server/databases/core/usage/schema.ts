import { z } from "zod";

export const usageSchema = z.object({
  id: z.string(),
  service_account_id: z.string(),
  feature_id: z.string(),
  quantity: z.number(),
  metadata: z.string().nullable(),
  timestamp: z.number(),
});

export type Usage = z.infer<typeof usageSchema>;
