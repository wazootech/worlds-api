import type { WorldsOptions } from "./types.ts";
import { Worlds } from "./worlds.ts";

export class WorldsSdk {
  public readonly worlds: Worlds;

  public constructor(options: WorldsOptions) {
    this.worlds = new Worlds(options);
  }
}
