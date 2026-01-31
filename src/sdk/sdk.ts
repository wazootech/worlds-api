import type { WorldsOptions } from "./schema.ts";
import { Worlds } from "./worlds.ts";

export class WorldsSdk {
  public readonly worlds: Worlds;

  public constructor(options: WorldsOptions) {
    this.worlds = new Worlds(options);
  }
}
