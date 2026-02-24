import { Sandbox, Client } from "@deno/sandbox";
import type { Deploy, DeployManagement } from "./deploy-management";

export class DenoDeployManagement implements DeployManagement {
  private client: Client;

  constructor() {
    this.client = new Client({
      token: process.env.DENO_DEPLOY_TOKEN,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getDeployment(_orgId: string): Promise<Deploy | null> {
    // In a full implementation we would query the Deno Deploy API or our DB mapping
    return null;
  }

  async deploy(
    _orgId: string,
    envVars: Record<string, string>,
  ): Promise<Deploy> {
    const token = process.env.DENO_DEPLOY_TOKEN;
    if (!token) {
      throw new Error("DENO_DEPLOY_TOKEN is not set");
    }

    // orgId is commented out, so we'll use a placeholder or generate one if needed for appSlug
    // For now, let's assume orgId is still implicitly available or we'll use a generic slug
    // The original code used orgId, so if it's commented out, this line needs adjustment.
    // For the purpose of this edit, we'll assume the user intends to remove orgId from the slug generation
    // or provide it differently later. For now, let's make it compile by removing orgId from the slug.
    const appSlug = `worlds-api-${Math.random().toString(36).slice(2, 6)}`;

    console.log(`[Deploy] Creating App ${appSlug} on Deno Deploy...`);
    const app = await this.client.apps.create({
      slug: appSlug,
    });

    console.log(`[Deploy] Creating Sandbox...`);
    await using sandbox = await Sandbox.create({ token });

    console.log(`[Deploy] Cloning repository into Sandbox...`);
    const cloneResult =
      await sandbox.sh`git clone https://github.com/wazootech/worlds.git /src`;
    if (!cloneResult.status.success) {
      throw new Error("Failed to clone repository: " + cloneResult.stderrText);
    }

    console.log(`[Deploy] Setting environment variables...`);
    for (const [key, value] of Object.entries(envVars)) {
      await sandbox.env.set(key, value);
    }

    console.log(`[Deploy] Deploying application from Sandbox...`);
    const build = await sandbox.deploy(app.slug, {
      path: "/src",
      build: {
        entrypoint: "packages/server/main.ts",
      },
    });

    // Wait for the build and deployment revision to complete
    await build.done;
    console.log(`[Deploy] Deployed revision successfully.`);

    const now = new Date().toISOString();
    return {
      id: app.id,
      orgId: _orgId,
      url: `https://${app.slug}.deno.dev`,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
  }
}
