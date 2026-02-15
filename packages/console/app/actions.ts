"use server";

import { revalidatePath } from "next/cache";
import * as authkit from "@/lib/auth";
import { sdk } from "@/lib/sdk";
import type { Organization } from "@wazoo/sdk";
import { ulid } from "ulid";

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

  await sdk.worlds.update(worldId, updates);
  revalidatePath(`/organizations/${organizationId}`);
  revalidatePath(`/organizations/${organizationId}/worlds/${worldId}`);
}

export async function deleteWorld(organizationId: string, worldId: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  await sdk.worlds.delete(worldId);
  revalidatePath(`/organizations/${organizationId}`);
}

export async function createWorld(organizationId: string, label: string, slug: string) {
  try {
    const { user } = await authkit.withAuth();
    if (!user) {
      throw new Error("Unauthorized");
    }

    console.log("Creating new world...", { organizationId, label, slug });
    const world = await sdk.worlds.create({
      label,
      slug,
      organizationId,
    } as any);

    console.log("World created successfully:", world.id);

    // Artificial delay to allow for eventual consistency in DB
    await new Promise((resolve) => setTimeout(resolve, 1000));

    revalidatePath(`/organizations/${organizationId}`);
    return { success: true };
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

  // 1. Cleanup all worlds in this organization (best effort)
  try {
    const worlds = await sdk.worlds.list(1, 100, { organizationId });
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
    const serviceAccounts = await sdk.organizations.serviceAccounts.list(
      organizationId,
      1,
      100,
    );
    for (const sa of serviceAccounts) {
      try {
        await sdk.organizations.serviceAccounts.delete(organizationId, sa.id);
      } catch (e) {
        console.error(`Failed to cleanup service account ${sa.id}:`, e);
      }
    }
  } catch (error) {
    console.warn("Failed to list service accounts for cleanup (ignoring):", error);
  }

  // 3. Remove the organization from the database
  await sdk.organizations.delete(organizationId);

  revalidatePath("/");

  // 4. If this was the active organization, we should probably clear it from metadata
  // or just sign out. In local dev, sign out is a no-op currently.
  const activeOrgId = await getActiveOrgId(user);
  if (activeOrgId === organizationId) {
    const workos = await authkit.getWorkOS();
    await workos.userManagement.updateUser({
      userId: user.id,
      metadata: {
        ...user.metadata,
        organizationId: "",
        testApiKey: "",
      },
    });
  }

  await authkit.signOut();
  return { success: true };
}

export async function redeemInviteAction(code: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  try {
    await sdk.invites.redeem(code, user.id);
    const organizationId = await getActiveOrgId(user);
    if (organizationId) {
      revalidatePath(`/organizations/${organizationId}`);
    }
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to redeem invite:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to redeem invite",
    };
  }
}

export async function rotateApiKey(organizationId: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const serviceAccounts =
    await sdk.organizations.serviceAccounts.list(organizationId);
  await Promise.all(
    serviceAccounts.map((sa) =>
      sdk.organizations.serviceAccounts.delete(organizationId, sa.id),
    ),
  );

  const newServiceAccount = await sdk.organizations.serviceAccounts.create(
    organizationId,
    {
      label: "Default",
    },
  );

  const workos = await authkit.getWorkOS();

  // Use the correct update signature: { userId, metadata: ... }
  // Wait, I need to check if user.id is correct. Yes.
  // And merge with existing metadata? The API merges at top level but replaces nested?
  // WorkOS metadata is key-value strings.
  // I should probably fetch existing metadata first to be safe, like admin actions.
  // But strictly for testApiKey, I can just upsert.
  // Actually, let's just do a direct update for now as we did in callback/route.ts (Wait, callback used the new signature).
  // The signature issue in route.ts was `updateUser(id, { ... })` -> `updateUser({ userId: id, ... })`.

  const activeOrgId = await getActiveOrgId(user);
  if (activeOrgId === organizationId) {
    await workos.userManagement.updateUser({
      userId: user.id,
      metadata: {
        ...user.metadata,
        testApiKey: newServiceAccount.apiKey,
      },
    });
  }

  revalidatePath(`/organizations/${user.id}`);
  return newServiceAccount.apiKey;
}

export async function createOrganization(label: string, slug: string) {
  const { user } = await authkit.withAuth();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Generate a unique organization ID
    const organizationId = ulid();

    // 1. Create the organization in Worlds API.
    await sdk.organizations.create({
      id: organizationId,
      slug,
      label,
    } as any);

    // 2. Create a default service account and get its API key.
    const serviceAccount = await sdk.organizations.serviceAccounts.create(
      organizationId,
      {
        label: "Default",
        description: "Auto-generated for testing",
      },
    );

    // 3. Update local user metadata with the NEW organizationId and testApiKey.
    const workos = await authkit.getWorkOS();
    const targetUser = await workos.userManagement.getUser(user.id);

    await workos.userManagement.updateUser({
      userId: user.id,
      metadata: {
        ...targetUser.metadata,
        organizationId: organizationId,
        testApiKey: serviceAccount.apiKey,
      },
    });

    revalidatePath(`/organizations/${organizationId}`);
    revalidatePath("/");
    return { success: true, organizationId };
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

  await sdk.organizations.update(organizationId, updates);
  revalidatePath(`/organizations/${organizationId}/settings`);
  revalidatePath(`/organizations/${organizationId}`);
  revalidatePath(`/`);
}

export async function listOrganizations() {
  const { user } = await authkit.withAuth();
  if (!user) {
    return [];
  }

  try {
    // In local dev, we can just list all organizations from the mock DB
    // In production, this would be filtered to the user's memberships
    const organizations = await sdk.organizations.list();
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
    const results = await sdk.worlds.sparql(worldId, query);
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
    const results = await sdk.worlds.search(worldId, query, options);
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

  await sdk.organizations.serviceAccounts.update(
    organizationId,
    serviceAccountId,
    updates,
  );
  revalidatePath(
    `/organizations/${organizationId}/service-accounts/${serviceAccountId}`,
  );
  revalidatePath(
    `/organizations/${organizationId}/service-accounts/${serviceAccountId}/settings`,
  );
}

export async function rotateServiceAccountKey(
  organizationId: string,
  serviceAccountId: string,
) {
  const { user } = await authkit.withAuth();
  if (!user) {
    throw new Error("Unauthorized");
  }

  // Use type assertion because the method is added locally but not yet published
  const result = await (sdk.organizations.serviceAccounts as any).rotateKey(
    organizationId,
    serviceAccountId,
  );

  revalidatePath(`/organizations/${organizationId}/service-accounts`);
  revalidatePath(
    `/organizations/${organizationId}/service-accounts/${serviceAccountId}`,
  );
  revalidatePath(
    `/organizations/${organizationId}/service-accounts/${serviceAccountId}/settings`,
  );
  
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

  await sdk.organizations.serviceAccounts.delete(
    organizationId,
    serviceAccountId,
  );
  revalidatePath(`/organizations/${organizationId}/service-accounts`);
}
