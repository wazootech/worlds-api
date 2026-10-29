/**
 * Physical Vectorize id of a chunk vector.
 *
 * `@worlds/cloudflare` does not export its VectorizeVectorSearchIndex from any
 * public entry point, so this mirrors its private `physicalId`: vectors are
 * namespaced per world (two worlds holding the same text must not share or
 * delete each other's vectors) and, since Vectorize caps ids at 64 bytes,
 * hashed as `v.` + base64url(SHA-256(`${worldId}\u0000${resultId}`)).
 * tests/byok-vector-cleanup.test.ts pins this against the installed package,
 * so an upstream change fails CI instead of silently orphaning vectors.
 */
export async function physicalVectorId(
  worldId: string,
  resultId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${worldId}\u0000${resultId}`),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  const base64Url = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `v.${base64Url}`;
}
