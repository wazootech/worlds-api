export interface AuthOrganization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  externalId: string; // The organization slug.
  metadata?: {
    apiBaseUrl?: string;
    apiKey?: string;
    deploymentUrl?: string;
    port?: number;
    [key: string]: unknown;
  };
}

export interface OrganizationManagement {
  deploy(orgId: string): Promise<{ url: string; port?: number }>;
  getOrganization(orgId: string): Promise<AuthOrganization | null>;
  getOrganizationByExternalId(
    externalId: string,
  ): Promise<AuthOrganization | null>;
  listOrganizations(options?: {
    limit?: number;
    before?: string;
    after?: string;
    order?: "asc" | "desc";
  }): Promise<{
    data: AuthOrganization[];
    listMetadata?: { before?: string; after?: string };
  }>;
  createOrganization(data: {
    name: string;
    slug: string;
    metadata?: {
      apiBaseUrl?: string;
      apiKey?: string;
      deploymentUrl?: string;
      port?: number;
      [key: string]: unknown;
    };
  }): Promise<AuthOrganization>;
  updateOrganization(
    orgId: string,
    data: { name?: string; slug?: string; metadata?: Record<string, unknown> },
  ): Promise<AuthOrganization>;
  deleteOrganization(orgId: string): Promise<void>;
}
