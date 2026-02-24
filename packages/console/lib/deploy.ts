import type {
  AuthOrganization,
  WorkOSManagement,
} from "./workos/workos-management";
import type { DeployManagement } from "./deno-deploy/deploy-management";
import type { TursoManagement } from "./turso/turso-management";

/**
 * Build the environment variables map for a deployed server instance.
 */
export function buildDeployEnvVars(
  org: AuthOrganization,
  overrides?: Record<string, string>,
): Record<string, string> {
  const envVars: Record<string, string> = {
    ADMIN_API_KEY: (org.metadata?.apiKey as string) || "default-key",
    LIBSQL_URL:
      (org.metadata?.libsqlUrl as string) || `file:./worlds_${org.id}.db`,
    LIBSQL_AUTH_TOKEN: (org.metadata?.libsqlAuthToken as string) || "",
    ...overrides,
  };

  if (org.metadata?.tursoApiToken)
    envVars.TURSO_API_TOKEN = org.metadata.tursoApiToken as string;
  if (org.metadata?.tursoOrg)
    envVars.TURSO_ORG = org.metadata.tursoOrg as string;

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
 *  4. Persists updated metadata
 */
export async function deployOrganization(
  orgId: string,
  workos: WorkOSManagement,
  deployManager: DeployManagement,
  tursoManager?: TursoManagement | null,
): Promise<{ url: string }> {
  const org = await workos.getOrganization(orgId);
  if (!org) throw new Error(`Organization not found: ${orgId}`);

  // For local dev: skip remote orgs
  const apiBaseUrl = org.metadata?.apiBaseUrl as string | undefined;
  const isRemote =
    apiBaseUrl &&
    !apiBaseUrl.startsWith("http://localhost") &&
    !apiBaseUrl.startsWith("http://127.0.0.1");

  if (isRemote) {
    return { url: apiBaseUrl as string };
  }

  // Auto-provision Turso database if available
  await provisionTursoIfNeeded(org, workos, tursoManager);

  // If the org already has a URL, re-deploy with current env vars
  if (apiBaseUrl && !isRemote) {
    const port = new URL(apiBaseUrl).port || "80";
    const envVars = buildDeployEnvVars(org, { PORT: port });
    await deployManager.deploy(org.id, envVars);
    return { url: apiBaseUrl };
  }

  // Allocate an available port (local dev only)
  // Exclude ports already assigned to other orgs in workos.json
  const { data: allOrgs } = await workos.listOrganizations({ limit: 100 });
  const usedPorts = allOrgs
    .map((o) => o.metadata?.apiBaseUrl as string | undefined)
    .filter((u): u is string => !!u && u.startsWith("http://localhost"))
    .map((u) => parseInt(new URL(u).port, 10))
    .filter((p) => !isNaN(p));

  const getPort = (await import("get-port")).default;
  const port = await getPort({ port: 8001, exclude: usedPorts });
  const url = `http://localhost:${port}`;

  org.metadata = { ...org.metadata, apiBaseUrl: url };
  await workos.updateOrganization(org.id, { metadata: org.metadata });

  const envVars = buildDeployEnvVars(org, { PORT: port.toString() });
  await deployManager.deploy(org.id, envVars);

  return { url };
}
