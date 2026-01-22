import type { WorldsOptions } from "#/sdk/types.ts";
import { Worlds } from "#/sdk/worlds.ts";

import { Accounts } from "./accounts.ts";

/**
 * InternalWorldsSdk is a TypeScript SDK for internal-only operations
 * on the Worlds API.
 */
export class InternalWorldsSdk {
  public readonly accounts: Accounts;
  public readonly worlds: Worlds;

  public constructor(options: WorldsOptions) {
    // Initialize internal SDK modules.
    this.accounts = new Accounts(options);

    // Initialize public SDK modules.
    this.worlds = new Worlds(options);
  }
}
