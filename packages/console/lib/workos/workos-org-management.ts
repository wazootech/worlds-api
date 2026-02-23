import type {
  AuthOrganization,
  OrganizationManagement,
} from "./org-management";

import { DeployManagement } from "../deno-deploy/deploy-management";

/**
 * WorkOS-backed organization management.
 *
 * Uses the WorkOS Node SDK to manage organizations.
 * This implementation will be filled in when WorkOS integration is enabled.
 */
export class WorkOSOrganizationManagement implements OrganizationManagement {
  constructor(private readonly deployManager: DeployManagement | null = null) {}

  async deploy(orgId: string): Promise<{ url: string; port?: number }> {
    const org = await this.getOrganization(orgId);
    if (!org) throw new Error(`Organization not found: ${orgId}`);

    if (!this.deployManager) {
      throw new Error("Deployment management not configured");
    }

    const apiKey = (org.metadata?.apiKey as string) || "default-key";
    const deployment = await this.deployManager.deployOrganization(org.id, {
      ADMIN_API_KEY: apiKey,
    });

    const port = parseInt(new URL(deployment.url).port || "80", 10);
    await this.updateOrganization(org.id, {
      metadata: { ...org.metadata, deploymentUrl: deployment.url, port },
    });

    return { url: deployment.url, port };
  }

  async getOrganization(orgId: string): Promise<AuthOrganization | null> {
    const { WorkOS } = await import("@workos-inc/node");
    const workos = new WorkOS(process.env.WORKOS_API_KEY!);
    try {
      const org = await workos.organizations.getOrganization(orgId);
      return mapWorkOSOrg(org);
    } catch {
      return null;
    }
  }

  async getOrganizationByExternalId(
    externalId: string,
  ): Promise<AuthOrganization | null> {
    const { WorkOS } = await import("@workos-inc/node");
    const workos = new WorkOS(process.env.WORKOS_API_KEY!);
    try {
      const org =
        await workos.organizations.getOrganizationByExternalId(externalId);
      return mapWorkOSOrg(org);
    } catch {
      return null;
    }
  }

  async listOrganizations(): Promise<AuthOrganization[]> {
    const { WorkOS } = await import("@workos-inc/node");
    const workos = new WorkOS(process.env.WORKOS_API_KEY!);
    const result = await workos.organizations.listOrganizations();
    return result.data.map(mapWorkOSOrg);
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
    const { WorkOS } = await import("@workos-inc/node");
    const workos = new WorkOS(process.env.WORKOS_API_KEY!);
    const org = await workos.organizations.createOrganization({
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
    const { WorkOS } = await import("@workos-inc/node");
    const workos = new WorkOS(process.env.WORKOS_API_KEY!);
    const org = await workos.organizations.updateOrganization({
      organization: orgId,
      name: data.name,
    });
    return mapWorkOSOrg(org);
  }

  async deleteOrganization(orgId: string): Promise<void> {
    const { WorkOS } = await import("@workos-inc/node");
    const workos = new WorkOS(process.env.WORKOS_API_KEY!);
    await workos.organizations.deleteOrganization(orgId);
  }
}

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
