import fs from "fs/promises";
import path from "path";
import type {
  AuthOrganization,
  OrganizationManagement,
} from "../org-management";

const STATE_FILE = path.join(process.cwd(), "local-state.json");

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
  async deploy(orgId: string): Promise<{ url: string; port?: number }> {
    const orgs = await this.load();
    const org = orgs.find((o) => o.id === orgId);
    if (!org) throw new Error(`Organization not found: ${orgId}`);

    if (org.metadata?.deploymentUrl) {
      return {
        url: org.metadata.deploymentUrl,
        port:
          org.metadata.port ??
          parseInt(new URL(org.metadata.deploymentUrl).port || "80", 10),
      };
    }

    const maxPort = orgs.reduce((max, o) => {
      if (o.metadata?.port) return Math.max(max, o.metadata.port as number);
      if (o.metadata?.deploymentUrl) {
        try {
          const port = parseInt(
            new URL(o.metadata.deploymentUrl as string).port,
            10,
          );
          return Math.max(max, port || 0);
        } catch {}
      }
      return max;
    }, 8000);

    const port = maxPort + 1;
    const url = `http://localhost:${port}`;

    org.metadata = { ...org.metadata, deploymentUrl: url, port };
    await this.updateOrganization(org.id, { metadata: org.metadata });

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

  async listOrganizations(): Promise<AuthOrganization[]> {
    return this.load();
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
