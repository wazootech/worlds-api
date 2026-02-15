import { LocalUserManagement } from "./user-managers/local-user-management";
import { AuthUser, UserManagement } from "./user-management";
import { NextResponse } from "next/server";

// Lazy singleton instance of UserManagement
let _userManagement: UserManagement | null = null;
async function getUserManagement(): Promise<UserManagement> {
  if (_userManagement) return _userManagement;
  _userManagement = new LocalUserManagement();
  return _userManagement;
}

// Re-export AuthUser for convenience
export type { AuthUser };

interface WithAuthResult {
  user: AuthUser | null;
}

// ---------------------------------------------------------------------------
// Public API – local implementation
// ---------------------------------------------------------------------------

export async function withAuth(): Promise<WithAuthResult> {
  const userManagement = await getUserManagement();
  return { user: await userManagement.getUser("local-dev") };
}

export async function getSignInUrl(): Promise<string> {
  return "/"; // just redirect home
}

export async function getSignUpUrl(): Promise<string> {
  return "/"; // just redirect home
}

/**
 * getWorkOS returns an object containing the userManagement instance.
 * (Kept for compatibility with existing code)
 */
export async function getWorkOS(): Promise<{ userManagement: UserManagement }> {
  return {
    userManagement: await getUserManagement(),
  };
}

export async function signOut(): Promise<void> {
  // In local mode, sign-out is a no-op.
  return;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleAuth(opts?: any): Promise<any> {
  // Return a handler that just redirects to the return path
  return () => {
    const returnPathname = opts?.returnPathname || "/";
    return NextResponse.redirect(
      new URL(returnPathname, "http://localhost:3000"),
    );
  };
}
