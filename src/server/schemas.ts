import { z } from "zod";

/**
 * accountRecordSchema is the Zod schema for AccountRecord.
 */
export const accountRecordSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  plan: z.string().optional(),
  apiKey: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
});

/**
 * createAccountParamsSchema is the Zod schema for CreateAccountParams.
 */
export const createAccountParamsSchema = accountRecordSchema.omit({
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  apiKey: true,
});

/**
 * updateAccountParamsSchema is the Zod schema for UpdateAccountParams.
 */
export const updateAccountParamsSchema = createAccountParamsSchema
  .partial()
  .omit({ id: true });

/**
 * worldRecordSchema is the Zod schema for WorldRecord.
 */
export const worldRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  label: z.string(),
  description: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
  isPublic: z.boolean().optional(),
});

/**
 * createWorldParamsSchema is the Zod schema for CreateWorldParams.
 */
export const createWorldParamsSchema = worldRecordSchema.omit({
  id: true,
  accountId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

/**
 * updateWorldParamsSchema is the Zod schema for UpdateWorldParams.
 */
export const updateWorldParamsSchema = createWorldParamsSchema.partial();

/**
 * conversationRecordSchema is the Zod schema for ConversationRecord.
 */
export const conversationRecordSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * createConversationParamsSchema is the Zod schema for CreateConversationParams.
 */
export const createConversationParamsSchema = conversationRecordSchema.omit({
  id: true,
  worldId: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * updateConversationParamsSchema is the Zod schema for UpdateConversationParams.
 */
export const updateConversationParamsSchema = createConversationParamsSchema
  .partial();

/**
 * messageRecordSchema is the Zod schema for MessageRecord.
 */
export const messageRecordSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  conversationId: z.string(),
  content: z.any(), // TODO: Type this properly with ModelMessage schema if available
  createdAt: z.number(),
});

/**
 * createMessageParamsSchema is the Zod schema for CreateMessageParams.
 */
export const createMessageParamsSchema = messageRecordSchema.omit({
  id: true,
  worldId: true,
  conversationId: true,
  createdAt: true,
});

/**
 * updateMessageParamsSchema is the Zod schema for UpdateMessageParams.
 */
export const updateMessageParamsSchema = createMessageParamsSchema.partial();

/**
 * SparqlValue represents a value in a SPARQL result.
 */
export const sparqlValueSchema = z.object({
  type: z.enum(["uri", "literal", "bnode"]),
  value: z.string(),
  "xml:lang": z.string().optional(),
  datatype: z.string().optional(),
});

/**
 * SparqlSelectResults represents the results of a SPARQL SELECT query.
 */
export const sparqlSelectResultsSchema = z.object({
  head: z.object({
    vars: z.array(z.string()),
    link: z.array(z.string()).optional(),
  }),
  results: z.object({
    bindings: z.array(z.record(z.string(), sparqlValueSchema)),
  }),
  boolean: z.undefined(),
});

/**
 * SparqlAskResults represents the results of a SPARQL ASK query.
 */
export const sparqlAskResultsSchema = z.object({
  head: z.object({
    link: z.array(z.string()).optional(),
  }),
  boolean: z.boolean(),
  results: z.undefined(),
});

/**
 * SparqlResults represents the results of a SPARQL query.
 */
export const sparqlResultsSchema = z.union([
  sparqlSelectResultsSchema,
  sparqlAskResultsSchema,
]);
