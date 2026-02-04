import { z } from "zod";

/**
 * serviceAccountTableSchema represents the database schema for service accounts.
 */
export const serviceAccountTableSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  api_key: z.string(),
  label: z.string().nullable(),
  description: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

/**
 * ServiceAccountTable represents a service account record.
 */
export type ServiceAccountTable = z.infer<typeof serviceAccountTableSchema>;

/**
 * serviceAccountTableInsertSchema represents the data required to insert a new service account.
 */
export const serviceAccountTableInsertSchema = serviceAccountTableSchema;

/**
 * ServiceAccountTableInsert represents the type for inserting a service account.
 */
export type ServiceAccountTableInsert = z.infer<
  typeof serviceAccountTableInsertSchema
>;

/**
 * serviceAccountTableUpdateSchema represents the data required to update a service account.
 */
export const serviceAccountTableUpdateSchema = serviceAccountTableSchema.pick({
  label: true,
  description: true,
  updated_at: true,
});

/**
 * ServiceAccountTableUpdate represents the type for updating a service account.
 */
export type ServiceAccountTableUpdate = z.infer<
  typeof serviceAccountTableUpdateSchema
>;

/**
 * createServiceAccountSchema represents the data required to create a service account via the API.
 */
export const createServiceAccountSchema = z.object({
  id: z.string().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

/**
 * updateServiceAccountSchema represents the data required to update a service account via the API.
 */
export const updateServiceAccountSchema = z.object({
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
