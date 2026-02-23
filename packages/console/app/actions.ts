"use server";

import { revalidatePath } from "next/cache";
import * as authkit from "@/lib/auth";

import { getSdkForOrg } from "@/lib/org-sdk";

async function getActiveOrgId(user: authkit.AuthUser) {
  // Always prefer metadata.organizationId if it exists
  return user.metadata?.organizationId as string | undefined;
}

export async function signOutAction() {
  await authkit.signOut();
}

export async function updateWorld(
  organizationId: string,
  worldId: string,
  updates: { label?: string; slug?: string; description?: string },
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) throw new Error("Organization not found");
  const sdk = getSdkForOrg(organization);

  // Resolve world to ensure we have the actual ID for mutation
  const world = await sdk.worlds.get(worldId);
  if (!world) {
    throw new Error("World not found");
  }

  await sdk.worlds.update(world.id, updates);

  const [resolvedWorld] = await Promise.all([sdk.worlds.get(world.id)]);

  if (resolvedWorld && organization) {
    const orgSlug = organization.externalId || organization.id;
    const worldSlug = resolvedWorld.slug || resolvedWorld.id;
    revalidatePath(`/organizations/${orgSlug}`);
    revalidatePath(`/organizations/${orgSlug}/worlds/${worldSlug}`);
  }
}

export async function deleteWorld(organizationId: string, worldId: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) throw new Error("Organization not found");
  const sdk = getSdkForOrg(organization);

  // Resolve world to ensure we have the actual ID for mutation
  const world = await sdk.worlds.get(worldId);
  if (!world) {
    throw new Error("World not found");
  }

  await sdk.worlds.delete(world.id);
  // Re-fetch organization to ensure we have the slug (since we might have just used ID above? No, we have the object)
  if (organization) {
    const orgSlug = organization.externalId || organization.id;
    revalidatePath(`/organizations/${orgSlug}`);
  }
}

export async function createWorld(
  organizationId: string,
  label: string,
  slug: string,
) {
  try {
    const { user } = await authkit.withAuth();
    if (!user) {
      throw new Error("Unauthorized");
    }

    // Resolve organization via OrganizationManagement
    const orgMgmt = await authkit.getOrganizationManagement();

    // The frontend might pass either an internal ID or an external slug
    let organization = await orgMgmt.getOrganization(organizationId);
    if (!organization) {
      // Fallback to checking by externalId (slug)
      organization = await orgMgmt.getOrganizationByExternalId(organizationId);
    }

    if (!organization) {
      throw new Error("Organization not found");
    }

    // Bootstrap: If no API config, try to provision one using Admin Key
    if (!organization.metadata?.apiBaseUrl || !organization.metadata?.apiKey) {
      // Only allowed if we have ADMIN_API_KEY
      const ADMIN_KEY = process.env.ADMIN_API_KEY;
      if (!ADMIN_KEY) {
        throw new Error(
          "Organization has no API config and no Admin Key available to provision one.",
        );
      }
      // Default URL
      const DEFAULT_URL =
        process.env.DEFAULT_API_URL || "http://localhost:8000";

      const { WorldsSdk } = await import("@wazoo/sdk");
      const adminSdk = new WorldsSdk({
        baseUrl: DEFAULT_URL,
        apiKey: ADMIN_KEY,
      });

      // Create Service Account
      const sa = await adminSdk.serviceAccounts.create(organization.id, {
        label: "Console SA",
      });

      // Save to Org Metadata
      await orgMgmt.updateOrganization(organization.id, {
        metadata: {
          apiBaseUrl: DEFAULT_URL,
          apiKey: sa.apiKey,
        },
      });

      // Reload organization
      const updatedOrg = await orgMgmt.getOrganization(organization.id);
      if (updatedOrg) {
        Object.assign(organization, updatedOrg);
      }
    }

    const sdk = getSdkForOrg(organization);

    const actualOrgId = organization.id;
    const orgSlug = organization.externalId || organization.id;

    console.log("Creating new world...", {
      organizationId: actualOrgId,
      label,
      slug,
    });
    const world = await sdk.worlds.create({
      label,
      slug,
    });

    console.log("World created successfully:", world.id);

    // Artificial delay to allow for eventual consistency in DB
    await new Promise((resolve) => setTimeout(resolve, 1000));

    revalidatePath(`/organizations/${actualOrgId}`);
    revalidatePath(`/organizations/${orgSlug}`);

    return { success: true, worldId: world.id, slug: world.slug };
  } catch (error) {
    console.error("Failed to create world:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function deleteOrganization(organizationId: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);

  if (!organization) {
    throw new Error("Organization not found");
  }

  const sdk = getSdkForOrg(organization);

  // 1. Cleanup all worlds in this organization (best effort)
  try {
    const worlds = await sdk.worlds.list({
      page: 1,
      pageSize: 100,
    });
    for (const world of worlds) {
      try {
        await sdk.worlds.delete(world.id);
      } catch (e) {
        console.error(`Failed to cleanup world ${world.id}:`, e);
      }
    }
  } catch (error) {
    console.warn("Failed to list worlds for cleanup (ignoring):", error);
  }

  // 2. Cleanup all service accounts in this organization (best effort)
  try {
    const serviceAccounts = await sdk.serviceAccounts.list(organization.id, {
      page: 1,
      pageSize: 100,
    });
    for (const sa of serviceAccounts) {
      try {
        await sdk.serviceAccounts.delete(organization.id, sa.id);
      } catch (e) {
        console.error(`Failed to cleanup service account ${sa.id}:`, e);
      }
    }
  } catch (error) {
    console.warn(
      "Failed to list service accounts for cleanup (ignoring):",
      error,
    );
  }

  // 3. Remove the organization via OrganizationManagement
  await orgMgmt.deleteOrganization(organization.id);

  revalidatePath("/");

  // 4. If this was the active organization, clear it from metadata
  const activeOrgId = await getActiveOrgId(user);
  if (activeOrgId === organizationId) {
    const workos = await authkit.getWorkOS();
    await workos.userManagement.updateUser({
      userId: user.id,
      metadata: {
        ...(user.metadata as unknown as Record<string, string | null>),
        organizationId: "",
        testApiKey: "",
      },
    });
  }

  await authkit.signOut();
  return { success: true };
}

export async function rotateApiKey(organizationId: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) throw new Error("Organization not found");
  const sdk = getSdkForOrg(organization);

  // Service accounts still go through the SDK (server-managed)
  const serviceAccounts = await sdk.serviceAccounts.list(organizationId);
  await Promise.all(
    serviceAccounts.map((sa) =>
      sdk.serviceAccounts.delete(organizationId, sa.id),
    ),
  );

  const newServiceAccount = await sdk.serviceAccounts.create(organizationId, {
    label: "Default",
  });

  const workos = await authkit.getWorkOS();

  const activeOrgId = await getActiveOrgId(user);
  if (activeOrgId === organizationId) {
    await workos.userManagement.updateUser({
      userId: user.id,
      metadata: {
        ...(user.metadata as unknown as Record<string, string | null>),
        testApiKey: newServiceAccount.apiKey || "",
      },
    });
  }

  revalidatePath(`/organizations/${organizationId}`);
  if (organization) {
    const orgSlug = organization.externalId || organization.id;
    revalidatePath(`/organizations/${orgSlug}`);
  }
  return newServiceAccount.apiKey || "";
}

export async function createOrganization(label: string, slug: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // 1. Create the organization via OrganizationManagement
    const orgMgmt = await authkit.getOrganizationManagement();
    const organization = await orgMgmt.createOrganization({
      name: label,
      slug,
    });

    const organizationId = organization.id;

    // 2. Create a default service account and get its API key.
    // We need to bootstrap the organization with an API connection first.

    let apiKey = "";
    const isLocalDev = !process.env.WORKOS_CLIENT_ID;

    if (isLocalDev) {
      apiKey = `sk_local_${Math.random().toString(36).substring(2, 15)}`;
      let deploymentUrl = "http://localhost:8001";
      try {
        const deployment = await orgMgmt.deploy(organization.id);
        deploymentUrl = deployment.url;
      } catch (error) {
        console.error("Failed to allocate local deployment", error);
      }

      await orgMgmt.updateOrganization(organization.id, {
        metadata: {
          apiBaseUrl: deploymentUrl,
          apiKey: apiKey,
        },
      });
    } else {
      const ADMIN_KEY = process.env.ADMIN_API_KEY;
      if (ADMIN_KEY) {
        const DEFAULT_URL =
          process.env.DEFAULT_API_URL || "http://localhost:8000";
        const { WorldsSdk } = await import("@wazoo/sdk");
        const adminSdk = new WorldsSdk({
          baseUrl: DEFAULT_URL,
          apiKey: ADMIN_KEY,
        });

        const sa = await adminSdk.serviceAccounts.create(organization.id, {
          label: "Default",
          description: "Auto-generated for testing",
        });
        apiKey = sa.apiKey || "";

        // Save metadata to organization
        await orgMgmt.updateOrganization(organization.id, {
          metadata: {
            apiBaseUrl: DEFAULT_URL,
            apiKey: apiKey,
          },
        });

        try {
          await orgMgmt.deploy(organization.id);
        } catch (error) {
          console.error("Failed to deploy newly created organization", error);
        }
      }
    }

    // 3. Update local user metadata with the NEW organizationId and testApiKey.
    const workos = await authkit.getWorkOS();
    const targetUser = await workos.userManagement.getUser(user.id);

    await workos.userManagement.updateUser({
      userId: user.id,
      metadata: {
        ...(targetUser.metadata as unknown as Record<string, string | null>),
        organizationId: organizationId,
        testApiKey: apiKey,
      },
    });

    revalidatePath(`/organizations/${organizationId}`);
    revalidatePath(`/organizations/${slug}`);
    revalidatePath("/");
    return { success: true, organizationId, slug };
  } catch (error) {
    console.error("Failed to create organization:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
export async function updateOrganization(
  organizationId: string,
  updates: { label?: string; slug?: string },
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) {
    throw new Error("Organization not found");
  }

  await orgMgmt.updateOrganization(organization.id, {
    name: updates.label,
    slug: updates.slug,
  });

  const resolvedOrganization = await orgMgmt.getOrganization(organization.id);
  if (resolvedOrganization) {
    const orgSlug = resolvedOrganization.externalId || resolvedOrganization.id;
    revalidatePath(`/organizations/${orgSlug}/settings`);
    revalidatePath(`/organizations/${orgSlug}`);
  }

  revalidatePath(`/`);
}

export async function selectOrganizationAction(organizationId: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) {
    throw new Error("Organization not found");
  }

  const workos = await authkit.getWorkOS();
  await workos.userManagement.updateUser({
    userId: user.id,
    metadata: {
      ...(user.metadata as unknown as Record<string, string | null>),
      organizationId: organization.id,
      testApiKey: organization.metadata?.apiKey || "",
    },
  });

  revalidatePath("/");
  const orgSlug = organization.externalId || organization.id;
  revalidatePath(`/organizations/${orgSlug}`);
}

export async function listOrganizations() {
  const { user } = await authkit.withAuth();
  if (!user) {
    return [];
  }

  try {
    const orgMgmt = await authkit.getOrganizationManagement();
    const organizations = await orgMgmt.listOrganizations();
    return organizations;
  } catch (error) {
    console.error("Failed to list organizations:", error);
    return [];
  }
}

export async function executeSparqlQuery(worldId: string, query: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  try {
    const orgMgmt = await authkit.getOrganizationManagement();
    const activeOrgId = await getActiveOrgId(user);
    if (!activeOrgId) throw new Error("No active organization");
    const organization = await orgMgmt.getOrganization(activeOrgId);
    if (!organization) throw new Error("Organization not found");
    const sdk = getSdkForOrg(organization);

    // Resolve world to ensure we have the actual ID for sub-resource call
    const world = await sdk.worlds.get(worldId);
    if (!world) {
      throw new Error("World not found");
    }
    const results = await sdk.worlds.sparql(world.id, query);
    return { success: true, results };
  } catch (error) {
    console.error("Failed to execute SPARQL query:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to execute query",
    };
  }
}

export async function searchTriples(
  worldId: string,
  query: string,
  options?: { limit?: number; subjects?: string[]; predicates?: string[] },
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  try {
    const orgMgmt = await authkit.getOrganizationManagement();
    const activeOrgId = await getActiveOrgId(user);
    if (!activeOrgId) throw new Error("No active organization");
    const organization = await orgMgmt.getOrganization(activeOrgId);
    if (!organization) throw new Error("Organization not found");
    const sdk = getSdkForOrg(organization);

    // Resolve world to ensure we have the actual ID for sub-resource call
    const world = await sdk.worlds.get(worldId);
    if (!world) {
      throw new Error("World not found");
    }
    const results = await sdk.worlds.search(world.id, query, options);
    return { success: true, results };
  } catch (error) {
    console.error("Failed to search triples:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to search",
    };
  }
}

export async function updateServiceAccount(
  organizationId: string,
  serviceAccountId: string,
  updates: { label?: string; description?: string },
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) throw new Error("Organization not found");
  const sdk = getSdkForOrg(organization);

  await sdk.serviceAccounts.update(organizationId, serviceAccountId, updates);

  if (organization) {
    const orgSlug = organization.externalId || organization.id;
    revalidatePath(
      `/organizations/${orgSlug}/service-accounts/${serviceAccountId}`,
    );
    revalidatePath(
      `/organizations/${orgSlug}/service-accounts/${serviceAccountId}/settings`,
    );
  }
}

export async function rotateServiceAccountKey(
  organizationId: string,
  serviceAccountId: string,
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) throw new Error("Organization not found");
  const sdk = getSdkForOrg(organization);

  const result = await sdk.serviceAccounts.rotateKey(
    organizationId,
    serviceAccountId,
  );

  if (organization) {
    const orgSlug = organization.externalId || organization.id;
    revalidatePath(`/organizations/${orgSlug}/service-accounts`);
    revalidatePath(
      `/organizations/${orgSlug}/service-accounts/${serviceAccountId}`,
    );
    revalidatePath(
      `/organizations/${orgSlug}/service-accounts/${serviceAccountId}/settings`,
    );
  }

  return result;
}

export async function deleteServiceAccount(
  organizationId: string,
  serviceAccountId: string,
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) throw new Error("Organization not found");
  const sdk = getSdkForOrg(organization);

  await sdk.serviceAccounts.delete(organizationId, serviceAccountId);
  if (organization) {
    const orgSlug = organization.externalId || organization.id;
    revalidatePath(`/organizations/${orgSlug}/service-accounts`);
  }
}

export async function listWorldLogs(
  worldId: string,
  page?: number,
  pageSize?: number,
  level?: string,
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  try {
    const orgMgmt = await authkit.getOrganizationManagement();
    const activeOrgId = await getActiveOrgId(user);
    if (!activeOrgId) throw new Error("No active organization");
    const organization = await orgMgmt.getOrganization(activeOrgId);
    if (!organization) throw new Error("Organization not found");
    const sdk = getSdkForOrg(organization);

    // Resolve world to ensure we have the actual ID for sub-resource call
    const world = await sdk.worlds.get(worldId);
    if (!world) {
      throw new Error("World not found");
    }
    const logs = await sdk.worlds.listLogs(world.id, { page, pageSize, level });

    return { success: true, logs };
  } catch (error) {
    console.error("Failed to list world logs:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to list logs",
    };
  }
}

export async function deployOrganizationAction(organizationId: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const orgMgmt = await authkit.getOrganizationManagement();
  const organization = await orgMgmt.getOrganization(organizationId);
  if (!organization) throw new Error("Organization not found");

  const deployment = await orgMgmt.deploy(organization.id);

  const orgSlug = organization.externalId || organization.id;
  revalidatePath(`/organizations/${orgSlug}`);
  revalidatePath(`/organizations/${organization.id}`);

  return { success: true, url: deployment.url };
}
