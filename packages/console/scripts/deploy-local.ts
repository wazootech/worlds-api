import { LocalOrganizationManagement } from "../lib/workos/local/local-org-management";
import { spawn, type ChildProcess } from "child_process";
import path from "path";

const activeProcesses = new Map<string, ChildProcess>();

function cleanupProcesses() {
  console.log("\n[Shutdown] Cleaning up local Deno processes...");
  for (const [orgId, child] of activeProcesses.entries()) {
    console.log(` - Killing server for org ${orgId}`);
    child.kill("SIGTERM");
  }
  activeProcesses.clear();
  process.exit(0);
}

process.on("SIGINT", cleanupProcesses);
process.on("SIGTERM", cleanupProcesses);

async function bootLocalOrgs() {
  try {
    const orgManager = new LocalOrganizationManagement();
    const orgs = await orgManager.listOrganizations();

    console.log(
      `[Startup] Found ${orgs.length} local organizations. Starting deployments...`,
    );
    for (const org of orgs) {
      try {
        const deployment = await orgManager.deploy(org.id);

        const port = deployment.port || 80;
        const serverEnv: Record<string, string> = {
          ...process.env,
          ADMIN_API_KEY:
            (org.metadata?.apiKey as string) || "default-local-key",
          PORT: port.toString(),
          LIBSQL_URL:
            (org.metadata?.libsqlUrl as string) || `file:./worlds_${org.id}.db`,
        };

        if (org.metadata?.tursoApiToken) {
          serverEnv.TURSO_API_TOKEN = org.metadata.tursoApiToken as string;
        }
        if (org.metadata?.tursoOrg) {
          serverEnv.TURSO_ORG = org.metadata.tursoOrg as string;
        }

        const serverDir = path.resolve(process.cwd(), "..", "server");

        console.log(` - Launching ${org.id} on port ${port}...`);
        const child = spawn(
          "deno",
          ["serve", "-A", "--env", "--port", port.toString(), "main.ts"],
          {
            cwd: serverDir,
            env: serverEnv as NodeJS.ProcessEnv,
            stdio: "inherit",
          },
        );

        activeProcesses.set(org.id, child);
      } catch (e) {
        console.error(`Failed to boot org ${org.id}`, e);
      }
    }
    console.log(
      `[Startup] Finished deploying local organizations. Press Ctrl+C to terminate.`,
    );

    // Keep the process alive so the detached Deno processes stay up
    // and can be gracefully killed on exit.
    setInterval(() => {}, 1000 * 60 * 60);
  } catch (e) {
    console.error("[Startup] Failed to auto-start local orgs:", e);
    process.exit(1);
  }
}

bootLocalOrgs();
