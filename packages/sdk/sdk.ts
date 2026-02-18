import type { WorldsSdkOptions } from "./options.ts";
import { Worlds } from "./clients/worlds/sdk.ts";
import { ServiceAccounts } from "./clients/service-accounts/sdk.ts";

/**
 * WorldsSdk is the main entry point for the Worlds API SDK.
 */
export class WorldsSdk {
  public readonly worlds: Worlds;
  public readonly serviceAccounts: ServiceAccounts;

  public constructor(options: WorldsSdkOptions) {
    this.worlds = new Worlds(options);
    this.serviceAccounts = new ServiceAccounts(options);
  }
}
