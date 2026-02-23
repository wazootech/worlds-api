import { AuthUser, UserManagement } from "@/lib/workos/user-management";
import fs from "fs/promises";
import path from "path";

const STATE_FILE = path.join(process.cwd(), "local-state.json");

const DEFAULT_USER: AuthUser = {
  id: process.env.LOCAL_USER_ID || "local-dev-user",
  email: process.env.LOCAL_USER_EMAIL || "dev@localhost",
  firstName: process.env.LOCAL_USER_FIRST_NAME || "Local",
  lastName: process.env.LOCAL_USER_LAST_NAME || "Developer",
  profilePictureUrl: null,
  metadata: { admin: "true" },
};

export class LocalUserManagement implements UserManagement {
  private async ensureStateFile() {
    try {
      await fs.access(STATE_FILE);
    } catch {
      await fs.writeFile(
        STATE_FILE,
        JSON.stringify({ user: DEFAULT_USER, organizations: [] }, null, 2),
      );
    }
  }

  private async readState(): Promise<{
    user: AuthUser;
    organizations: unknown[];
  }> {
    await this.ensureStateFile();
    try {
      const data = await fs.readFile(STATE_FILE, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.warn(
        "Failed to read local-state.json, falling back to default:",
        error,
      );
      return { user: { ...DEFAULT_USER }, organizations: [] };
    }
  }

  private async writeUser(user: AuthUser) {
    const state = await this.readState();
    state.user = user;
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  }

  async getUser(): Promise<AuthUser> {
    const state = await this.readState();
    return state.user;
  }

  async updateUser(opts: {
    userId: string;
    metadata?: AuthUser["metadata"];
  }): Promise<AuthUser> {
    const state = await this.readState();
    const user = state.user;
    const updatedUser: AuthUser = {
      ...user,
      metadata: { ...(user.metadata || {}), ...opts.metadata },
    };
    await this.writeUser(updatedUser);
    return updatedUser;
  }

  async deleteUser(): Promise<void> {
    // In local mode, we don't really delete the user, just reset it
    await this.writeUser({ ...DEFAULT_USER });
  }

  async listUsers(): Promise<{
    data: AuthUser[];
    listMetadata?: { after?: string };
  }> {
    const state = await this.readState();
    return { data: [state.user], listMetadata: {} };
  }
}
