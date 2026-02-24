import { NextResponse } from "next/server";
import type { WorkOSManagement } from "./workos/management";

// ---------------------------------------------------------------------------
// Detect mode: use WorkOS when credentials are present and not in local mode
// ---------------------------------------------------------------------------
const isLocalDev = !process.env.WORKOS_CLIENT_ID;

// ---------------------------------------------------------------------------
// Cached Management Instance
// ---------------------------------------------------------------------------
let _workosManagement: WorkOSManagement | null = null;

// ---------------------------------------------------------------------------
// Turso Management – lazy helper
// ---------------------------------------------------------------------------

async function getTursoManager() {
  if (process.env.TURSO_API_TOKEN && process.env.TURSO_ORG) {
    const { TursoManagementImpl } = await import("./turso/turso-management");
    return new TursoManagementImpl({
      token: process.env.TURSO_API_TOKEN,
      org: process.env.TURSO_ORG,
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Re-export AuthUser & AuthOrganization for convenience
// ---------------------------------------------------------------------------
export type { AuthUser, AuthOrganization } from "./workos/management";

// ---------------------------------------------------------------------------
// getWorkOS – Core Singleton Accessor
// ---------------------------------------------------------------------------

export async function getWorkOS(
  opts: { skipCache?: boolean } = {},
): Promise<WorkOSManagement> {
  if (_workosManagement && !opts.skipCache) {
    return _workosManagement;
  }

  if (isLocalDev) {
    const { LocalWorkOSManagementImpl } =
      await import("./workos/local/local-management");
    const { LocalDeployManagement } =
      await import("./deno-deploy/local/local-deploy-management");
    const deployManager = LocalDeployManagement.getInstance();
    const tursoManager = await getTursoManager();
    _workosManagement = new LocalWorkOSManagementImpl(
      deployManager,
      tursoManager,
    );
  } else {
    const { WorkOSManagementImpl } = await import("./workos/workos-management");

    let deployManager = null;
    if (process.env.DENO_DEPLOY_TOKEN) {
      const { DenoDeployManagement } =
        await import("./deno-deploy/deno-deploy-management");
      deployManager = new DenoDeployManagement();
    }
    const tursoManager = await getTursoManager();
    _workosManagement = new WorkOSManagementImpl(deployManager, tursoManager);
  }

  return _workosManagement;
}

// ---------------------------------------------------------------------------
// withAuth – returns the current user session
// ---------------------------------------------------------------------------

interface LocalWithAuthResult {
  user: import("./workos/management").AuthUser | null;
}

export async function withAuth(): Promise<LocalWithAuthResult> {
  if (!isLocalDev) {
    const workos = await import("@workos-inc/authkit-nextjs");
    return workos.withAuth();
  }

  const workos = await getWorkOS();
  return { user: await workos.getUser("local-dev") };
}

// ---------------------------------------------------------------------------
// getInitialAuth – for passing server-side auth data to AuthKitProvider
// ---------------------------------------------------------------------------

export async function getInitialAuth() {
  if (!isLocalDev) {
    try {
      const workos = await import("@workos-inc/authkit-nextjs");
      const auth = await workos.withAuth();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { accessToken, ...initialAuth } = auth;
      return initialAuth;
    } catch {
      // withAuth may fail if middleware hasn't processed the request yet
      return undefined;
    }
  }

  // In local mode, return undefined – AuthKitProvider won't render
  return undefined;
}

// ---------------------------------------------------------------------------
// getSignInUrl / getSignUpUrl
// ---------------------------------------------------------------------------

export async function getSignInUrl(opts?: { state?: string }): Promise<string> {
  if (!isLocalDev) {
    const workos = await import("@workos-inc/authkit-nextjs");
    return workos.getSignInUrl(opts);
  }
  return "/"; // just redirect home
}

export async function getSignUpUrl(): Promise<string> {
  if (!isLocalDev) {
    const workos = await import("@workos-inc/authkit-nextjs");
    return workos.getSignUpUrl();
  }
  return "/"; // just redirect home
}

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  if (!isLocalDev) {
    const workos = await import("@workos-inc/authkit-nextjs");
    return workos.signOut();
  }
  // In local mode, sign-out is a no-op.
}

// ---------------------------------------------------------------------------
// handleAuth
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleAuth(opts?: any): Promise<any> {
  if (!isLocalDev) {
    const workos = await import("@workos-inc/authkit-nextjs");
    return workos.handleAuth(opts);
  }

  // Return a handler that just redirects to the return path
  return () => {
    const returnPathname = opts?.returnPathname || "/";
    return NextResponse.redirect(
      new URL(returnPathname, "http://localhost:3000"),
    );
  };
}
