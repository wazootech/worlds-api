export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl?: string | null;
  metadata?: {
    organizationId?: string | null;
    testApiKey?: string | null;
    admin?: string | null;
  };
}

export interface UserManagement {
  getUser(userId: string): Promise<AuthUser>;

  updateUser(opts: {
    userId: string;
    metadata?: AuthUser["metadata"];
  }): Promise<AuthUser>;

  deleteUser(userId: string): Promise<void>;

  listUsers(opts?: Record<string, unknown>): Promise<{
    data: AuthUser[];
    listMetadata?: { after?: string };
  }>;
}

export interface AuthOrganization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  externalId: string; // The organization slug
  metadata?: {
    apiBaseUrl?: string;
    apiKey?: string;
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
      [key: string]: unknown;
    };
  }): Promise<AuthOrganization>;
  updateOrganization(
    orgId: string,
    data: { name?: string; slug?: string; metadata?: Record<string, unknown> },
  ): Promise<AuthOrganization>;
  deleteOrganization(orgId: string): Promise<void>;
}

export interface WorkOSManagement
  extends UserManagement, OrganizationManagement {}
