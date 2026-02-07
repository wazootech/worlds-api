import type { Client } from "@libsql/client";
import { organizationsTable } from "./organizations/queries.sql.ts";
import {
  worldsOrganizationIdIndex,
  worldsTable,
} from "./worlds/queries.sql.ts";
import { invitesRedeemedByIndex, invitesTable } from "./invites/queries.sql.ts";
import {
  serviceAccountsApiKeyIndex,
  serviceAccountsOrganizationIdIndex,
  serviceAccountsTable,
} from "./service-accounts/queries.sql.ts";
import { rateLimitsTable } from "./rate-limits/queries.sql.ts";
import {
  metricsServiceAccountIdIndex,
  metricsTable,
} from "./metrics/queries.sql.ts";

/**
 * initializeDatabase creates all main tables and indexes if they don't exist.
 */
export async function initializeDatabase(client: Client): Promise<void> {
  // Create tables
  await client.execute(organizationsTable);
  await client.execute(worldsTable);
  await client.execute(invitesTable);
  await client.execute(serviceAccountsTable);
  await client.execute(rateLimitsTable);
  await client.execute(metricsTable);

  // Create indexes
  await client.execute(worldsOrganizationIdIndex);
  await client.execute(invitesRedeemedByIndex);
  await client.execute(serviceAccountsOrganizationIdIndex);
  await client.execute(serviceAccountsApiKeyIndex);
  await client.execute(metricsServiceAccountIdIndex);
}
