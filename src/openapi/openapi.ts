import type { OpenAPIV3_1 } from "openapi-types";
import { World } from "./components/schemas/world.ts";
import rpcPath from "./paths/rpc.ts";

export const openapiDocument: OpenAPIV3_1.Document = {
  openapi: "3.1.0",
  info: {
    title: "Worlds API",
    version: "1.0.0",
    description: "API for managing decentralized, multi-model semantic worlds.",
  },
  paths: {
    ...rpcPath,
  },
  components: {
    schemas: {
      World: World,
    },
  },
};

if (import.meta.main) {
  console.log(JSON.stringify(openapiDocument, null, 2));
}
