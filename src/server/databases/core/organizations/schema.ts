import { z } from "zod";

/**
 * organizationTableSchema is the Zod schema for the organizations database table.
 * This represents the raw database row structure.
 */
export const organizationTableSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  description: z.string().nullable(),
  plan: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  deleted_at: z.number().nullable(),
});

/**
 * OrganizationTable represents an organization record as stored in the database.
 */
export type OrganizationTable = z.infer<typeof organizationTableSchema>;

/**
 * organizationTableInsertSchema is the Zod schema for inserting a new organization.
 */
export const organizationTableInsertSchema = organizationTableSchema;

/**
 * OrganizationTableInsert represents the data needed to insert a new organization.
 */
export type OrganizationTableInsert = z.infer<
  typeof organizationTableInsertSchema
>;

/**
 * organizationTableUpdateSchema is the Zod schema for updating an organization.
 */
export const organizationTableUpdateSchema = organizationTableSchema
  .pick({ label: true, description: true, plan: true, updated_at: true })
  .partial();

/**
 * OrganizationTableUpdate represents the data needed to update an organization.
 */
export type OrganizationTableUpdate = z.infer<
  typeof organizationTableUpdateSchema
>;

/**
 * organizationRowSchema is the Zod schema for an organization record as returned by the SELECT queries.
 */
export const organizationRowSchema = organizationTableSchema;

/**
 * OrganizationRow represents an organization record.
 */
export type OrganizationRow = z.infer<typeof organizationRowSchema>;
