import fs from "fs/promises";
import path from "path";
import type {
  AuthUser,
  AuthOrganization,
  WorkOSManagement,
} from "../management";
import type { DeployManagement } from "../../deno-deploy/deploy-management";
import type { TursoManagement } from "../../turso/turso-management";

const STATE_FILE = path.join(process.cwd(), "data", "workos.json");

const DEFAULT_USER: AuthUser = {
  id: process.env.LOCAL_USER_ID || "local-dev-user",
  email: process.env.LOCAL_USER_EMAIL || "dev@localhost",
  firstName: process.env.LOCAL_USER_FIRST_NAME || "Local",
  lastName: process.env.LOCAL_USER_LAST_NAME || "Developer",
  profilePictureUrl: null,
  metadata: { admin: "true" },
};

function generateId(): string {
  return `org_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export class LocalWorkOSManagementImpl implements WorkOSManagement {
  constructor(
    private readonly deployManager: DeployManagement | null = null,
    private readonly tursoManager: TursoManagement | null = null,
  ) {}

  private async ensureStateFile() {
    try {
      await fs.access(STATE_FILE);
    } catch {
      await fs.writeFile(
        STATE_FILE,
        JSON.stringify({ user: DEFAULT_USER, organizations: [] }, null, 2),
      );
    }
  }

  private async readState(): Promise<{
    user: AuthUser;
    organizations: AuthOrganization[];
  }> {
    await this.ensureStateFile();
    try {
      const data = await fs.readFile(STATE_FILE, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.warn(
        "Failed to read local-state.json, falling back to default:",
        error,
      );
      return { user: { ...DEFAULT_USER }, organizations: [] };
    }
  }

  private async writeState(state: {
    user: AuthUser;
    organizations: AuthOrganization[];
  }): Promise<void> {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }

  // --- User Management ---

  async getUser(): Promise<AuthUser> {
    const state = await this.readState();
    return state.user;
  }

  async updateUser(opts: {
    userId: string;
    metadata?: AuthUser["metadata"];
  }): Promise<AuthUser> {
    const state = await this.readState();
    const user = state.user;
    const updatedUser: AuthUser = {
      ...user,
      metadata: { ...(user.metadata || {}), ...opts.metadata },
    };
    state.user = updatedUser;
    await this.writeState(state);
    return updatedUser;
  }

  async deleteUser(): Promise<void> {
    // In local mode, we don't really delete the user, just reset it
    const state = await this.readState();
    state.user = { ...DEFAULT_USER };
    await this.writeState(state);
  }

  async listUsers(): Promise<{
    data: AuthUser[];
    listMetadata?: { after?: string };
  }> {
    const state = await this.readState();
    return { data: [state.user], listMetadata: {} };
  }

  // --- Organization Management ---

  async deploy(orgId: string): Promise<{ url: string; port?: number }> {
    const state = await this.readState();
    const orgs = state.organizations || [];
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

    // Auto-provision a Turso database if available and not already configured
    if (this.tursoManager && !org.metadata?.libsqlUrl) {
      try {
        const db = await this.tursoManager.createDatabase(org.id);
        org.metadata = {
          ...org.metadata,
          libsqlUrl: db.url,
          libsqlAuthToken: db.authToken,
        };
        await this.updateOrganization(org.id, { metadata: org.metadata });
        console.log(
          `[local-deploy] Provisioned Turso database for org ${orgId}: ${db.url}`,
        );
      } catch (error) {
        console.error(
          `[local-deploy] Failed to provision Turso database for org ${orgId}:`,
          error,
        );
      }
    }

    // If already deployed, return existing info
    if (org.metadata?.apiBaseUrl && !isRemote) {
      const parsedPort = parseInt(
        new URL(org.metadata.apiBaseUrl as string).port || "80",
        10,
      );

      if (this.deployManager) {
        const envVars: Record<string, string> = {
          ADMIN_API_KEY:
            (org.metadata?.apiKey as string) || "default-local-key",
          PORT: parsedPort.toString(),
          LIBSQL_URL:
            (org.metadata?.libsqlUrl as string) || `file:./worlds_${org.id}.db`,
          LIBSQL_AUTH_TOKEN: (org.metadata?.libsqlAuthToken as string) || "",
        };
        if (org.metadata?.tursoApiToken) {
          envVars.TURSO_API_TOKEN = org.metadata.tursoApiToken as string;
        }
        if (org.metadata?.tursoOrg) {
          envVars.TURSO_ORG = org.metadata.tursoOrg as string;
        }
        if (process.env.GOOGLE_API_KEY) {
          envVars.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
        }
        if (process.env.GOOGLE_EMBEDDINGS_MODEL) {
          envVars.GOOGLE_EMBEDDINGS_MODEL = process.env.GOOGLE_EMBEDDINGS_MODEL;
        }
        await this.deployManager.deploy(org.id, envVars);
      }

      return { url: org.metadata.apiBaseUrl as string, port: parsedPort };
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

    org.metadata = { ...org.metadata, apiBaseUrl: url };
    await this.updateOrganization(org.id, { metadata: org.metadata });

    // Start the server process if we have a deploy manager
    if (this.deployManager) {
      const envVars: Record<string, string> = {
        ADMIN_API_KEY: (org.metadata?.apiKey as string) || "default-local-key",
        PORT: port.toString(),
        LIBSQL_URL:
          (org.metadata?.libsqlUrl as string) || `file:./worlds_${org.id}.db`,
        LIBSQL_AUTH_TOKEN: (org.metadata?.libsqlAuthToken as string) || "",
      };
      if (org.metadata?.tursoApiToken) {
        envVars.TURSO_API_TOKEN = org.metadata.tursoApiToken as string;
      }
      if (org.metadata?.tursoOrg) {
        envVars.TURSO_ORG = org.metadata.tursoOrg as string;
      }
      if (process.env.GOOGLE_API_KEY) {
        envVars.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
      }
      if (process.env.GOOGLE_EMBEDDINGS_MODEL) {
        envVars.GOOGLE_EMBEDDINGS_MODEL = process.env.GOOGLE_EMBEDDINGS_MODEL;
      }
      await this.deployManager.deploy(org.id, envVars);
    }

    return { url, port };
  }

  async getOrganization(orgId: string): Promise<AuthOrganization | null> {
    const state = await this.readState();
    const orgs = state.organizations || [];
    const org = orgs.find((o) => o.id === orgId) ?? null;
    return org;
  }

  async getOrganizationByExternalId(
    externalId: string,
  ): Promise<AuthOrganization | null> {
    const state = await this.readState();
    const orgs = state.organizations || [];
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
    const state = await this.readState();
    let orgs = state.organizations || [];

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
      const allOrgs = state.organizations || [];
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
    const state = await this.readState();
    const orgs = state.organizations || [];
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

    state.organizations = orgs;
    await this.writeState(state);

    return org;
  }

  async updateOrganization(
    orgId: string,
    data: { name?: string; slug?: string; metadata?: Record<string, unknown> },
  ): Promise<AuthOrganization> {
    const state = await this.readState();
    const orgs = state.organizations || [];
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
    state.organizations = orgs;
    await this.writeState(state);
    return org;
  }

  async deleteOrganization(orgId: string): Promise<void> {
    const state = await this.readState();
    const orgs = state.organizations || [];
    const idx = orgs.findIndex((o) => o.id === orgId || o.externalId === orgId);
    if (idx === -1) throw new Error(`Organization not found: ${orgId}`);

    orgs.splice(idx, 1);
    state.organizations = orgs;
    await this.writeState(state);
  }
}
