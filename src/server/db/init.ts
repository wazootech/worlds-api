import type { Client } from "@libsql/client";
import {
  organizationsApiKeyIndex,
  organizationsTable,
} from "./resources/organizations/queries.sql.ts";
import {
  worldsOrganizationIdIndex,
  worldsTable,
} from "./resources/worlds/queries.sql.ts";
import {
  chunksFtsDeleteTrigger,
  chunksFtsInsertTrigger,
  chunksFtsTable,
  chunksFtsUpdateTrigger,
  chunksPredicateIndex,
  chunksSubjectIndex,
  chunksTable,
  chunksTripleIdIndex,
  chunksVectorIndex,
} from "./resources/chunks/queries.sql.ts";
import { triplesTable } from "./resources/triples/queries.sql.ts";
import {
  invitesRedeemedByIndex,
  invitesTable,
} from "./resources/invites/queries.sql.ts";

/**
 * initializeDatabase creates all tables and indexes if they don't exist.
 */
export async function initializeDatabase(client: Client): Promise<void> {
  // Create tables
  await client.execute(organizationsTable);
  await client.execute(worldsTable);
  await client.execute(invitesTable);

  // Create indexes
  await client.execute(organizationsApiKeyIndex);
  await client.execute(worldsOrganizationIdIndex);
  await client.execute(invitesRedeemedByIndex);
}

/**
 * initializeWorldDatabase creates all world-specific tables and indexes if they don't exist.
 */
export async function initializeWorldDatabase(client: Client): Promise<void> {
  // Create tables
  await client.execute(chunksTable);
  await client.execute(chunksFtsTable);
  await client.execute(triplesTable);

  // Create indexes
  await client.execute(chunksTripleIdIndex);
  await client.execute(chunksSubjectIndex);
  await client.execute(chunksPredicateIndex);
  await client.execute(chunksVectorIndex);

  // Create triggers
  await client.execute(chunksFtsInsertTrigger);
  await client.execute(chunksFtsDeleteTrigger);
  await client.execute(chunksFtsUpdateTrigger);
}
