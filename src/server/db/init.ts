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
