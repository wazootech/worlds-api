import { z } from "zod";

/**
 * ServiceAccount represents a service account for API access.
 */
export interface ServiceAccount {
  id: string;
  organizationId: string;
  label: string;
  description: string | null;
  apiKey?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * serviceAccountSchema is the Zod schema for ServiceAccount.
 */
export const serviceAccountSchema: z.ZodType<ServiceAccount> = z.object({
  id: z.string(),
  organizationId: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  apiKey: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * CreateServiceAccountParams represents the parameters for creating a service account.
 */
export interface CreateServiceAccountParams {
  label: string;
  description?: string;
}

/**
 * createServiceAccountParamsSchema is the Zod schema for CreateServiceAccountParams.
 */
export const createServiceAccountParamsSchema: z.ZodType<
  CreateServiceAccountParams
> = z.object({
  label: z.string(),
  description: z.string().optional(),
});

/**
 * UpdateServiceAccountParams represents the parameters for updating a service account.
 */
export interface UpdateServiceAccountParams {
  label?: string;
  description?: string;
}

/**
 * updateServiceAccountParamsSchema is the Zod schema for UpdateServiceAccountParams.
 */
export const updateServiceAccountParamsSchema: z.ZodType<
  UpdateServiceAccountParams
> = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
});
