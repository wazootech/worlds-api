import { LocalUserManagement } from "./user-managers/local-user-management";
import { AuthUser, UserManagement } from "./user-management";
import { NextResponse } from "next/server";

const isLocalDev = process.env.LOCAL_DEV_MODE === "true";

// Lazy singleton instance of UserManagement
let _userManagement: UserManagement | null = null;
async function getUserManagement(): Promise<UserManagement> {
  if (_userManagement) return _userManagement;

  if (isLocalDev) {
    _userManagement = new LocalUserManagement();
  } else {
    const { WorkOSUserManagement } = await import(
      "./user-managers/workos-user-management"
    );
    _userManagement = new WorkOSUserManagement();
  }
  return _userManagement;
}

// Re-export AuthUser for convenience
export type { AuthUser };

interface WithAuthResult {
  user: AuthUser | null;
}

// ---------------------------------------------------------------------------
// Public API – mirrors the subset of @workos-inc/authkit-nextjs we use
// ---------------------------------------------------------------------------

export async function withAuth(): Promise<WithAuthResult> {
  if (isLocalDev) {
    const userManagement = await getUserManagement();
    return { user: await userManagement.getUser("local-dev") };
  }

  const authkit = await import("@workos-inc/authkit-nextjs");
  return authkit.withAuth() as unknown as Promise<WithAuthResult>;
}

export async function getSignInUrl(): Promise<string> {
  if (isLocalDev) {
    return "/"; // just redirect home
  }

  const authkit = await import("@workos-inc/authkit-nextjs");
  return authkit.getSignInUrl();
}

export async function getSignUpUrl(): Promise<string> {
  if (isLocalDev) {
    return "/"; // just redirect home
  }

  const authkit = await import("@workos-inc/authkit-nextjs");
  return authkit.getSignUpUrl();
}

/**
 * getWorkOS returns an object containing the userManagement instance.
 * Note: This must be called inside an async context if you need the userManagement
 * instance immediately, or used carefully as it returns a promise-based getter
 * or we can return the promise itself. Let's return the instance directly by making
 * this function async.
 */
export async function getWorkOS(): Promise<{ userManagement: UserManagement }> {
  return {
    userManagement: await getUserManagement(),
  };
}

export async function signOut(): Promise<void> {
  if (isLocalDev) {
    // In local mode, sign-out is a no-op. The redirect happens elsewhere.
    return;
  }

  const authkit = await import("@workos-inc/authkit-nextjs");
  return authkit.signOut();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleAuth(opts?: any): Promise<any> {
  if (isLocalDev) {
    // Return a handler that just redirects to the return path
    return (_req: Request) => {
      const returnPathname = opts?.returnPathname || "/";
      return NextResponse.redirect(
        new URL(returnPathname, "http://localhost:3000"),
      );
    };
  }

  const authkit = await import("@workos-inc/authkit-nextjs");
  return authkit.handleAuth(opts);
}
