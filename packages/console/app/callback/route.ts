import { handleAuth, getWorkOS, type AuthUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const returnPath = cookieStore.get("auth_return_path")?.value || "/";

  // Delete the cookie immediately after reading
  if (cookieStore.get("auth_return_path")) {
    cookieStore.delete("auth_return_path");
  }

  // Create a handler with the return path

  return await (
    await handleAuth({
      returnPathname: returnPath,
      onSuccess: async (data: { user: AuthUser }) => {
        if (!data.user) {
          return;
        }

        try {
          const workos = await getWorkOS();

          // Skip if user already has an organization.
          try {
            const existingOrganization = await workos.getOrganization(
              data.user.id,
            );
            if (existingOrganization) {
              return;
            }
          } catch {
            // Organization not found, proceed to create
          }

          // Create the organization.
          const slug = data.user.firstName
            ? data.user.firstName.toLowerCase().replace(/\s+/g, "-")
            : data.user.id; // Fallback to ID if no name

          const newOrg = await workos.createOrganization({
            name: `${data.user.firstName || "User"}'s Org`,
            slug: slug,
          });

          // Create a default service account for the organization using Admin SDK
          const ADMIN_KEY = process.env.ADMIN_API_KEY;
          let apiKey = "";

          if (ADMIN_KEY) {
            const DEFAULT_URL =
              process.env.DEFAULT_API_URL || "http://localhost:8000";
            const { WorldsSdk } = await import("@wazoo/sdk");
            const adminSdk = new WorldsSdk({
              baseUrl: DEFAULT_URL,
              apiKey: ADMIN_KEY,
            });

            const serviceAccount = await adminSdk.serviceAccounts.create(
              newOrg.id,
              {
                label: "Default",
                description: "Auto-generated for testing",
              },
            );
            apiKey = serviceAccount.apiKey || "";

            // Update org metadata
            await workos.updateOrganization(newOrg.id, {
              metadata: {
                apiBaseUrl: DEFAULT_URL,
                apiKey: apiKey,
              },
            });

            try {
              await workos.deploy(newOrg.id);
            } catch (e) {
              console.error("Failed to deploy newly created organization", e);
            }
          }

          // Update WorkOS user metadata.
          await workos.updateUser({
            userId: data.user.id,
            metadata: {
              organizationId: newOrg.id,
              testApiKey: apiKey || null, // Ensure string or null
            },
          });
        } catch (error) {
          console.error("Error in callback route:", error);
          throw error; // Re-throw to trigger AuthKit error handling.
        }
      },
    })
  )(request);
}
