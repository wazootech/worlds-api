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
  factsFtsDeleteTrigger,
  factsFtsInsertTrigger,
  factsFtsTable,
  factsFtsUpdateTrigger,
  factsItemIdIndex,
  factsPropertyIndex,
  factsTable,
  factsVectorIndex,
} from "./resources/facts/queries.sql.ts";
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
  await client.execute(factsTable);
  await client.execute(factsFtsTable);

  // Create indexes
  await client.execute(factsItemIdIndex);
  await client.execute(factsPropertyIndex);
  await client.execute(factsVectorIndex);

  // Create triggers
  await client.execute(factsFtsInsertTrigger);
  await client.execute(factsFtsDeleteTrigger);
  await client.execute(factsFtsUpdateTrigger);
}
