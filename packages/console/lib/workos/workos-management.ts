import type {
  AuthUser,
  AuthOrganization,
  WorkOSManagement,
} from "./management";

import { DeployManagement } from "../deno-deploy/deploy-management";
import type { TursoManagement } from "../turso/turso-management";
import { WorkOS } from "@workos-inc/node";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapWorkOSOrg(org: any): AuthOrganization {
  return {
    id: org.id,
    name: org.name,
    createdAt: org.createdAt ?? org.created_at ?? new Date().toISOString(),
    updatedAt: org.updatedAt ?? org.updated_at ?? new Date().toISOString(),
    externalId: org.externalId ?? org.external_id ?? org.id,
    metadata: org.metadata,
  };
}

export class WorkOSManagementImpl implements WorkOSManagement {
  private readonly workos: WorkOS;

  constructor(
    private readonly deployManager: DeployManagement | null = null,
    private readonly tursoManager: TursoManagement | null = null,
  ) {
    if (!process.env.WORKOS_API_KEY) {
      throw new Error("WORKOS_API_KEY is missing");
    }

    this.workos = new WorkOS(process.env.WORKOS_API_KEY);
  }

  // User Management
  async getUser(userId: string): Promise<AuthUser> {
    return this.workos.userManagement.getUser(userId);
  }

  async updateUser(opts: {
    userId: string;
    metadata?: Record<string, string>;
  }): Promise<AuthUser> {
    return this.workos.userManagement.updateUser(opts);
  }

  async deleteUser(userId: string): Promise<void> {
    return this.workos.userManagement.deleteUser(userId);
  }

  async listUsers(opts?: Record<string, unknown>): Promise<{
    data: AuthUser[];
    listMetadata?: { after?: string };
  }> {
    return this.workos.userManagement.listUsers(opts);
  }

  // Organization Management
  async deploy(orgId: string): Promise<{ url: string; port?: number }> {
    const org = await this.getOrganization(orgId);
    if (!org) throw new Error(`Organization not found: ${orgId}`);

    if (!this.deployManager) {
      throw new Error("Deployment management not configured");
    }

    // Auto-provision a Turso database if available and not already configured
    if (this.tursoManager && !org.metadata?.libsqlUrl) {
      try {
        const db = await this.tursoManager.createDatabase(org.id);
        org.metadata = {
          ...org.metadata,
          libsqlUrl: db.url,
          libsqlAuthToken: db.authToken,
        };
        await this.updateOrganization(org.id, {
          metadata: org.metadata,
        });
        console.log(
          `[deploy] Provisioned Turso database for org ${orgId}: ${db.url}`,
        );
      } catch (error) {
        console.error(
          `[deploy] Failed to provision Turso database for org ${orgId}:`,
          error,
        );
      }
    }

    const apiKey = (org.metadata?.apiKey as string) || "default-key";
    const envVars: Record<string, string> = {
      ADMIN_API_KEY: apiKey,
      LIBSQL_URL:
        (org.metadata?.libsqlUrl as string) || `file:./worlds_${org.id}.db`,
      LIBSQL_AUTH_TOKEN: (org.metadata?.libsqlAuthToken as string) || "",
    };

    if (org.metadata?.tursoApiToken)
      envVars.TURSO_API_TOKEN = org.metadata?.tursoApiToken as string;
    if (org.metadata?.tursoOrg)
      envVars.TURSO_ORG = org.metadata?.tursoOrg as string;

    // Pass along server-side secrets to the remote Deno sandbox
    if (process.env.GOOGLE_API_KEY)
      envVars.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    if (process.env.GOOGLE_EMBEDDINGS_MODEL)
      envVars.GOOGLE_EMBEDDINGS_MODEL = process.env.GOOGLE_EMBEDDINGS_MODEL;

    const deployment = await this.deployManager.deploy(org.id, envVars);

    await this.updateOrganization(org.id, {
      metadata: { ...org.metadata },
    });

    return { url: deployment.url };
  }

  async getOrganization(orgId: string): Promise<AuthOrganization | null> {
    try {
      const org = await this.workos.organizations.getOrganization(orgId);
      return mapWorkOSOrg(org);
    } catch {
      return null;
    }
  }

  async getOrganizationByExternalId(
    externalId: string,
  ): Promise<AuthOrganization | null> {
    try {
      const org =
        await this.workos.organizations.getOrganizationByExternalId(externalId);
      return mapWorkOSOrg(org);
    } catch {
      return null;
    }
  }

  async listOrganizations(options?: {
    limit?: number;
    before?: string;
    after?: string;
    order?: "asc" | "desc";
  }): Promise<{
    data: AuthOrganization[];
    listMetadata?: { before?: string; after?: string };
  }> {
    const result = await this.workos.organizations.listOrganizations(options);
    return {
      data: result.data.map(mapWorkOSOrg),
      listMetadata: result.listMetadata,
    };
  }

  async createOrganization(data: {
    name: string;
    slug: string;
    metadata?: {
      apiBaseUrl?: string;
      apiKey?: string;
      [key: string]: string | number | undefined;
    };
  }): Promise<AuthOrganization> {
    const org = await this.workos.organizations.createOrganization({
      name: data.name,
      externalId: data.slug,
      metadata: data.metadata as Record<string, string>,
    });

    return mapWorkOSOrg(org);
  }

  async updateOrganization(
    orgId: string,
    data: { name?: string; slug?: string; metadata?: Record<string, unknown> },
  ): Promise<AuthOrganization> {
    const org = await this.workos.organizations.updateOrganization({
      organization: orgId,
      name: data.name,
    });
    return mapWorkOSOrg(org);
  }

  async deleteOrganization(orgId: string): Promise<void> {
    await this.workos.organizations.deleteOrganization(orgId);
  }
}
