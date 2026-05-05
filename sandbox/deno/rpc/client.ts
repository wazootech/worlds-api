const baseUrl = Deno.env.get("WORLDS_RPC_URL") ?? "http://localhost:8001/rpc";
const apiKey = Deno.env.get("WORLDS_API_KEY");

if (!apiKey) {
  console.log("Set WORLDS_API_KEY from the server output.");
  Deno.exit(1);
}

async function rpc(action: string, request: unknown) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ action, request }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function section(title: string): void {
  console.log("\n===", title, "===");
}

section("create world");
console.log(
  await rpc("createWorld", {
    namespace: "demo",
    id: "rpc-earth",
    displayName: "RPC Earth",
  }),
);

section("import N-Quads");
const nquads = [
  '<https://example.com/earth> <https://schema.org/name> "Earth" .',
  '<https://example.com/earth> <https://schema.org/description> "Blue marble with oceans" .',
  '<https://example.com/earth> <https://schema.org/diameter> "12742" .',
  "<https://example.com/earth> <https://schema.org/containsPlace> <https://example.com/moon> .",
  '<https://example.com/moon> <https://schema.org/name> "Moon" .',
].join("\n");

console.log(
  await rpc("importWorld", {
    source: "demo/rpc-earth",
    data: nquads,
    contentType: "application/n-quads",
  }),
);

section("sparql SELECT");
console.log(
  await rpc("sparql", {
    source: "demo/rpc-earth",
    query:
      "SELECT ?label WHERE { <https://example.com/earth> <https://schema.org/name> ?label }",
  }),
);

section("search");
console.log(
  await rpc("searchWorlds", {
    sources: ["demo/rpc-earth"],
    query: "blue marble",
  }),
);

section("export N-Quads");
console.log(
  await rpc("exportWorld", {
    source: "demo/rpc-earth",
    contentType: "application/n-quads",
  }),
);

section("list worlds");
console.log(await rpc("listWorlds", {}));
