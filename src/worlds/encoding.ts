import { Store } from "oxigraph";

export type EncodableEncoding =
  | "application/n-quads"
  | "application/trig"
  | "text/turtle"
  | "application/n-triples"
  | "application/ld+json"
  | "application/rdf+xml";

export type DecodableEncoding = EncodableEncoding;

export const encodableEncodings: EncodableEncoding[] = [
  "application/n-quads",
  "application/trig",
  "text/turtle",
  "application/n-triples",
  "application/ld+json",
  "application/rdf+xml",
];
export const decodableEncodings: DecodableEncoding[] = [
  "application/n-quads",
  "application/trig",
  "text/turtle",
  "application/n-triples",
  "application/ld+json",
];

export function isEncodableEncoding(
  encoding: string,
): encoding is EncodableEncoding {
  return encodableEncodings.includes(encoding as EncodableEncoding);
}

export function isDecodableEncoding(
  encoding: string,
): encoding is DecodableEncoding {
  return decodableEncodings.includes(encoding as DecodableEncoding);
}

export function acceptsEncoding(
  req: Request,
  encodings: string[],
): string | null {
  const accept = req.headers.get("Accept");
  if (!accept) return encodings[0];
  for (const enc of encodings) {
    if (accept.includes(enc)) return enc;
  }
  if (accept.includes("*/*")) return encodings[0];
  return null;
}

export function contentEncoding(req: Request): string | null {
  return req.headers.get("Content-Type");
}

export function encodeStore(store: Store, encoding: string): Promise<string> {
  try {
    return Promise.resolve(
      store.dump({ format: encoding }),
    );
  } catch (e) {
    return Promise.reject(new Error(`Failed to encode store: ${e}`));
  }
}

export async function decodeStore(
  body: ReadableStream<Uint8Array> | null,
  encoding: string,
): Promise<Store> {
  const store = new Store();
  if (!body) return store;
  const text = await new Response(body).text();
  try {
    store.load(text, { format: encoding, base_iri: "http://example.com" });
    return store;
  } catch (e) {
    throw new Error(`Failed to decode store: ${e}`);
  }
}
