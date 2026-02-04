import { createClient } from "@libsql/client";
import { ulid } from "@std/ulid/ulid";
import { initializeDatabase } from "./databases/core/init.ts";
import { MemoryDatabaseManager } from "./database-manager/database-managers/memory.ts";
import { insertOrganization } from "./databases/core/organizations/queries.sql.ts";
import type { Embeddings } from "./embeddings/embeddings.ts";
import type { AppContext } from "./app-context.ts";
import { ChunksService } from "./databases/world/chunks/service.ts";
import { InvitesService } from "./databases/core/invites/service.ts";
import { LogsService } from "#/server/databases/world/logs/service.ts";
import { OrganizationsService } from "./databases/core/organizations/service.ts";
import { RateLimitsService } from "./databases/core/rate-limits/service.ts";
import { ServiceAccountsService } from "./databases/core/service-accounts/service.ts";
import { TriplesService } from "./databases/world/triples/service.ts";
import { UsageService } from "./databases/core/usage/service.ts";
import { WorldsService } from "./databases/core/worlds/service.ts";

export interface TestContext extends AppContext {
  usageService: UsageService;
  rateLimitsService: RateLimitsService;
  invitesService: InvitesService;
  logsService: LogsService;
  organizationsService: OrganizationsService;
  serviceAccountsService: ServiceAccountsService;
  triplesService: TriplesService;
  worldsService: WorldsService;
  chunksService: ChunksService;
}

export async function createTestContext(): Promise<TestContext> {
  const client = createClient({ url: ":memory:" });
  await initializeDatabase(client);

  const mockEmbeddings: Embeddings = {
    dimensions: 1536,
    embed: (texts: string | string[]) => {
      if (Array.isArray(texts)) {
        return Promise.resolve(Array(texts.length).fill(Array(1536).fill(0)));
      }
      return Promise.resolve(Array(1536).fill(0));
    },
  };

  const usageService = new UsageService(client);
  const rateLimitsService = new RateLimitsService(client);
  const invitesService = new InvitesService(client);
  const logsService = new LogsService(client);
  const organizationsService = new OrganizationsService(client);
  const serviceAccountsService = new ServiceAccountsService(client);
  const triplesService = new TriplesService(client);
  const worldsService = new WorldsService(client);

  const partialContext = {
    database: client,
    embeddings: mockEmbeddings,
    databaseManager: new MemoryDatabaseManager(worldsService),
    usageService,
    rateLimitsService,
    invitesService,
    logsService,
    organizationsService,
    serviceAccountsService,
    triplesService,
    worldsService,
    admin: {
      apiKey: ulid(),
    },
  };

  const chunksService = new ChunksService(
    partialContext as unknown as AppContext,
    worldsService,
  );

  return {
    ...partialContext,
    usageService,
    rateLimitsService,
    invitesService,
    logsService,
    organizationsService,
    serviceAccountsService,
    triplesService,
    worldsService,
    chunksService,
  };
}

export async function createTestOrganization(
  context: TestContext,
  options?: { plan?: string },
) {
  const id = ulid();
  const now = Date.now();
  await context.database.execute({
    sql: insertOrganization,
    args: [
      id,
      "Test Org",
      "Description",
      options?.plan ?? "free",
      now,
      now,
      null,
    ],
  });
  // Return the admin API key for authentication, as org keys are no longer valid
  return { id, apiKey: context.admin!.apiKey };
}

export async function createTestServiceAccount(
  context: TestContext,
  organizationId: string,
) {
  const accountId = ulid();
  const apiKey = ulid();
  const now = Date.now();
  await context.serviceAccountsService.add({
    id: accountId,
    organization_id: organizationId,
    label: "Test Service Account",
    description: null,
    api_key: apiKey,
    created_at: now,
    updated_at: now,
  });
  return { id: accountId, apiKey };
}
