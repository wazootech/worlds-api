import fs from "fs/promises";
import path from "path";
import type {
  AuthOrganization,
  OrganizationManagement,
} from "../org-management";
import type { DeployManagement } from "../../deno-deploy/deploy-management";

const STATE_FILE = path.join(process.cwd(), "data", "workos.json");

function generateId(): string {
  return `org_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export class LocalOrganizationManagement implements OrganizationManagement {
  constructor(private readonly deployManager: DeployManagement | null = null) {}

  async deploy(orgId: string): Promise<{ url: string; port?: number }> {
    const orgs = await this.load();
    const org = orgs.find((o) => o.id === orgId);
    if (!org) throw new Error(`Organization not found: ${orgId}`);

    const apiBaseUrl = org.metadata?.apiBaseUrl as string | undefined;
    const isRemote =
      apiBaseUrl &&
      !apiBaseUrl.startsWith("http://localhost") &&
      !apiBaseUrl.startsWith("http://127.0.0.1");

    // If it points to a remote API, just return the remote API URL directly without attempting to deploy locally
    if (isRemote) {
      return { url: apiBaseUrl as string };
    }

    // If already deployed, return existing info
    if (org.metadata?.apiBaseUrl && !isRemote) {
      const port = parseInt(
        new URL(org.metadata.apiBaseUrl as string).port || "80",
        10,
      );

      // If we have a deploy manager, ensure the process is actually running
      if (this.deployManager) {
        const envVars: Record<string, string> = {
          ADMIN_API_KEY:
            (org.metadata?.apiKey as string) || "default-local-key",
          PORT: port.toString(),
          LIBSQL_URL:
            (org.metadata?.libsqlUrl as string) || `file:./worlds_${org.id}.db`,
        };
        if (org.metadata?.tursoApiToken) {
          envVars.TURSO_API_TOKEN = org.metadata.tursoApiToken as string;
        }
        if (org.metadata?.tursoOrg) {
          envVars.TURSO_ORG = org.metadata.tursoOrg as string;
        }
        await this.deployManager.deploy(org.id, envVars);
      }

      return { url: org.metadata.apiBaseUrl as string, port };
    }

    // Assign a new port
    const maxPort = orgs.reduce((max, o) => {
      if (
        o.metadata?.apiBaseUrl &&
        !(o.metadata?.apiBaseUrl as string).startsWith("http://localhost")
      )
        return max;
      if (o.metadata?.apiBaseUrl) {
        try {
          const port = parseInt(
            new URL(o.metadata.apiBaseUrl as string).port,
            10,
          );
          return Math.max(max, port || 0);
        } catch {}
      }
      return max;
    }, 8000);

    const port = maxPort + 1;
    const url = `http://localhost:${port}`;

    delete org.metadata?.deploymentUrl;
    delete org.metadata?.port;
    org.metadata = { ...org.metadata, apiBaseUrl: url };
    await this.updateOrganization(org.id, { metadata: org.metadata });

    // Start the server process if we have a deploy manager
    if (this.deployManager) {
      const envVars: Record<string, string> = {
        ADMIN_API_KEY: (org.metadata?.apiKey as string) || "default-local-key",
        PORT: port.toString(),
        LIBSQL_URL:
          (org.metadata?.libsqlUrl as string) || `file:./worlds_${org.id}.db`,
      };
      if (org.metadata?.tursoApiToken) {
        envVars.TURSO_API_TOKEN = org.metadata.tursoApiToken as string;
      }
      if (org.metadata?.tursoOrg) {
        envVars.TURSO_ORG = org.metadata.tursoOrg as string;
      }
      await this.deployManager.deploy(org.id, envVars);
    }

    return { url, port };
  }

  private async load(): Promise<AuthOrganization[]> {
    try {
      const data = await fs.readFile(STATE_FILE, "utf-8");
      const state = JSON.parse(data);
      return state.organizations || [];
    } catch {
      return [];
    }
  }

  private async save(orgs: AuthOrganization[]): Promise<void> {
    let state: { organizations: AuthOrganization[] } = { organizations: orgs };
    try {
      const data = await fs.readFile(STATE_FILE, "utf-8");
      state = JSON.parse(data);
      state.organizations = orgs;
    } catch {
      // If state file doesn't exist, we'll create it with just orgs (user will be added when user management runs)
    }
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }

  async getOrganization(orgId: string): Promise<AuthOrganization | null> {
    const orgs = await this.load();
    const org = orgs.find((o) => o.id === orgId) ?? null;
    return org;
  }

  async getOrganizationByExternalId(
    externalId: string,
  ): Promise<AuthOrganization | null> {
    const orgs = await this.load();
    return orgs.find((o) => o.externalId === externalId) ?? null;
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
    let orgs = await this.load();

    if (options?.order === "desc") {
      orgs.reverse();
    }

    if (options?.after) {
      const index = orgs.findIndex((o) => o.id === options.after);
      if (index !== -1) {
        orgs = orgs.slice(index + 1);
      }
    }

    if (options?.before) {
      const index = orgs.findIndex((o) => o.id === options.before);
      if (index !== -1) {
        orgs = orgs.slice(0, index);
      }
    }

    const limit = options?.limit ?? 10;
    const paginatedOrgs = orgs.slice(0, limit);

    let after: string | undefined;
    let before: string | undefined;

    if (paginatedOrgs.length > 0) {
      const allOrgs = await this.load();
      if (options?.order === "desc") allOrgs.reverse();

      const lastItem = paginatedOrgs[paginatedOrgs.length - 1];
      const firstItem = paginatedOrgs[0];

      const lastIndexInAll = allOrgs.findIndex((o) => o.id === lastItem.id);
      if (lastIndexInAll < allOrgs.length - 1) {
        after = lastItem.id;
      }

      const firstIndexInAll = allOrgs.findIndex((o) => o.id === firstItem.id);
      if (firstIndexInAll > 0) {
        before = firstItem.id;
      }
    }

    return {
      data: paginatedOrgs,
      listMetadata: { before, after },
    };
  }

  async createOrganization(data: {
    name: string;
    slug: string;
    metadata?: {
      apiBaseUrl?: string;
      apiKey?: string;
      [key: string]: string | undefined;
    };
  }): Promise<AuthOrganization> {
    const orgs = await this.load();
    const now = new Date().toISOString();
    const org: AuthOrganization = {
      id: generateId(),
      name: data.name,
      createdAt: now,
      updatedAt: now,
      externalId: data.slug || slugify(data.name),
      metadata: data.metadata,
    };
    if (!org.externalId) org.externalId = org.id;
    orgs.push(org);
    await this.save(orgs);

    return org;
  }

  async updateOrganization(
    orgId: string,
    data: { name?: string; slug?: string; metadata?: Record<string, unknown> },
  ): Promise<AuthOrganization> {
    const orgs = await this.load();
    const idx = orgs.findIndex((o) => o.id === orgId || o.externalId === orgId);
    if (idx === -1) throw new Error(`Organization not found: ${orgId}`);

    const org = orgs[idx];
    if (data.name !== undefined) org.name = data.name;
    if (data.slug !== undefined) org.externalId = data.slug;
    if (data.metadata !== undefined) {
      org.metadata = { ...org.metadata, ...data.metadata };
    }
    org.updatedAt = new Date().toISOString();

    orgs[idx] = org;
    await this.save(orgs);
    return org;
  }

  async deleteOrganization(orgId: string): Promise<void> {
    const orgs = await this.load();
    const idx = orgs.findIndex((o) => o.id === orgId || o.externalId === orgId);
    if (idx === -1) throw new Error(`Organization not found: ${orgId}`);

    orgs.splice(idx, 1);
    await this.save(orgs);
  }
}
