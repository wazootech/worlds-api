import { AuthUser, UserManagement } from "@/lib/user-management";

const LOCAL_USER_ID = process.env.LOCAL_USER_ID || "local-dev-user";
const LOCAL_USER_EMAIL = process.env.LOCAL_USER_EMAIL || "dev@localhost";
const LOCAL_USER_FIRST_NAME = process.env.LOCAL_USER_FIRST_NAME || "Local";
const LOCAL_USER_LAST_NAME = process.env.LOCAL_USER_LAST_NAME || "Developer";

export class LocalUserManagement implements UserManagement {
  private user: AuthUser = {
    id: LOCAL_USER_ID,
    email: LOCAL_USER_EMAIL,
    firstName: LOCAL_USER_FIRST_NAME,
    lastName: LOCAL_USER_LAST_NAME,
    profilePictureUrl: null,
    metadata: { admin: "true" },
  };

  async getUser(_userId: string): Promise<AuthUser> {
    return { ...this.user };
  }

  async updateUser(opts: {
    userId: string;
    metadata?: Record<string, string>;
  }): Promise<AuthUser> {
    this.user = {
      ...this.user,
      metadata: { ...this.user.metadata, ...opts.metadata },
    };
    return { ...this.user };
  }

  async deleteUser(_userId: string): Promise<void> {
    // no-op in local mode
  }

  async listUsers(
    _opts?: Record<string, unknown>,
  ): Promise<{ data: AuthUser[]; listMetadata?: { after?: string } }> {
    return { data: [{ ...this.user }], listMetadata: {} };
  }
}
