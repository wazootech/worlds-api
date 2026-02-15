/*
import * as authkit from "@workos-inc/authkit-nextjs";
import { AuthUser, UserManagement } from "@/lib/user-management";

export class WorkOSUserManagement implements UserManagement {
  async getUser(userId: string): Promise<AuthUser> {
    return authkit.getWorkOS().userManagement.getUser(userId);
  }

  async updateUser(opts: {
    userId: string;
    metadata?: Record<string, string>;
  }): Promise<AuthUser> {
    return authkit.getWorkOS().userManagement.updateUser(opts);
  }

  async deleteUser(userId: string): Promise<void> {
    return authkit.getWorkOS().userManagement.deleteUser(userId);
  }

  async listUsers(opts?: Record<string, unknown>): Promise<{
    data: AuthUser[];
    listMetadata?: { after?: string };
  }> {
    return authkit.getWorkOS().userManagement.listUsers(opts);
  }
}
*/
