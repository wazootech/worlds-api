import type {
  AuthOrganization,
  WorkOSManagement,
} from "./workos/workos-management";
import type { DeployManagement } from "./deno-deploy/deploy-management";
import type { TursoManagement } from "./turso/turso-management";

/**
 * Build the environment variables map for a deployed server instance.
 */
export function buildDeployEnvVars(opts: {
  org: AuthOrganization;
  port?: string;
  libsqlUrl?: string;
}): Record<string, string> {
  const { org, port, libsqlUrl } = opts;
  const envVars: Record<string, string> = {
    ADMIN_API_KEY: org.metadata?.apiKey || "",
    LIBSQL_URL: libsqlUrl || org.metadata?.libsqlUrl || "",
    LIBSQL_AUTH_TOKEN: org.metadata?.libsqlAuthToken || "",
  };

  if (port) {
    envVars.PORT = port;
  }

  if (org.metadata?.tursoApiToken) {
    envVars.TURSO_API_TOKEN = org.metadata.tursoApiToken;
  }
  if (org.metadata?.tursoOrg) {
    envVars.TURSO_ORG = org.metadata.tursoOrg;
  }

  // Pass along server-side secrets
  if (process.env.GOOGLE_API_KEY)
    envVars.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  if (process.env.GOOGLE_EMBEDDINGS_MODEL)
    envVars.GOOGLE_EMBEDDINGS_MODEL = process.env.GOOGLE_EMBEDDINGS_MODEL;

  return envVars;
}

/**
 * Auto-provision a Turso database for the organization if one hasn't
 * been configured yet. Mutates org.metadata and persists the update.
 */
async function provisionTursoIfNeeded(
  org: AuthOrganization,
  workos: WorkOSManagement,
  tursoManager: TursoManagement | null | undefined,
): Promise<void> {
  if (!tursoManager || org.metadata?.libsqlUrl) return;

  try {
    const db = await tursoManager.createDatabase(org.id);
    org.metadata = {
      ...org.metadata,
      libsqlUrl: db.url,
      libsqlAuthToken: db.authToken,
    };
    await workos.updateOrganization(org.id, { metadata: org.metadata });
    console.log(
      `[deploy] Provisioned Turso database for org ${org.id}: ${db.url}`,
    );
  } catch (error) {
    console.error(
      `[deploy] Failed to provision Turso database for org ${org.id}:`,
      error,
    );
  }
}

/**
 * Orchestrates deployment of an organization's server:
 *  1. Looks up the org
 *  2. Auto-provisions a Turso database if needed
 *  3. Builds env vars and calls the deploy manager
 *  4. Updates org metadata with the actual deployment URL
 */
export async function deployOrganization(
  orgId: string,
  workos: WorkOSManagement,
  deployManager: DeployManagement,
  tursoManager?: TursoManagement | null,
): Promise<{ url: string }> {
  const org = await workos.getOrganization(orgId);
  if (!org) throw new Error(`Organization not found: ${orgId}`);

  // Auto-provision Turso database if available
  await provisionTursoIfNeeded(org, workos, tursoManager);

  // Determine local SQLite fallback if no remote DB exists
  const localDbUrl = `file:./worlds_${org.id}.db`;
  const libsqlUrl = org.metadata?.libsqlUrl || localDbUrl;

  const currentApiUrl = org.metadata?.apiBaseUrl;
  const isLocal =
    !currentApiUrl ||
    currentApiUrl.startsWith("http://localhost") ||
    currentApiUrl.startsWith("http://127.0.0.1");

  let port: string | undefined;

  if (isLocal) {
    // Allocate an available port (local dev only)
    // Exclude ports already assigned to other orgs in workos.json
    const { data: allOrgs } = await workos.listOrganizations({ limit: 100 });
    const usedPorts = allOrgs
      .map((o) => o.metadata?.apiBaseUrl)
      .filter((u): u is string => !!u && u.startsWith("http://localhost"))
      .map((u) => {
        try {
          return parseInt(new URL(u).port, 10);
        } catch {
          return NaN;
        }
      })
      .filter((p) => !isNaN(p));

    const getPort = (await import("get-port")).default;
    const allocatedPort = await getPort({
      port: currentApiUrl ? parseInt(new URL(currentApiUrl).port, 10) : 8001,
      exclude: usedPorts,
    });
    port = allocatedPort.toString();
  }

  const envVars = buildDeployEnvVars({
    org,
    port,
    libsqlUrl,
  });

  const deployment = await deployManager.deploy(org.id, envVars);

  // Update org metadata with the actual deployment result
  org.metadata = {
    ...org.metadata,
    apiBaseUrl: deployment.url,
  };
  await workos.updateOrganization(org.id, { metadata: org.metadata });

  return { url: deployment.url };
}
