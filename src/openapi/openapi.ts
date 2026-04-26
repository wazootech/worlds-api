import type { OpenAPIV3_1 } from "openapi-types";
import { createClient } from "@hey-api/openapi-ts";
import { collectPathItems, collectSchemas, importGlob } from "./utils.ts";

const pathsGlob = new URL("./paths/*.path-item.ts", import.meta.url);
const paths = await importGlob(pathsGlob).then((modules) =>
  collectPathItems(modules)
);

const schemasGlob = new URL(
  "./components/schemas/*.schema.ts",
  import.meta.url,
);
const schemas = await importGlob(schemasGlob).then((modules) =>
  collectSchemas(modules)
);

export const document: OpenAPIV3_1.Document = {
  openapi: "3.1.0",
  info: {
    title: "Worlds API",
    version: "1.0.0",
    description: "API for managing decentralized, multi-model semantic worlds.",
  },
  paths,
  components: {
    schemas,
  },
};

if (import.meta.main) {
  await createClient([
    {
      input: document,
      output: {
        path: "./src/models",
        fileName: "openapi-ts",
        entryFile: false,
      },
      plugins: [
        // https://heyapi.dev/openapi-ts/plugins/typescript
        { name: "@hey-api/typescript",},
      ],
    },
  ]);
}
