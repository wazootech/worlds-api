import type { StoredQuad } from "./stored-quad.ts";
import type { ContentType } from "#/openapi/generated/types.gen.ts";

const RE_NTRIPLES_URI = /^<([^>]+)> <([^>]+)> <([^>]+)> \.$/;
const RE_NTRIPLES_BNODE = /^_:(\w+) <([^>]+)> <([^>]+)> \.$/;
const RE_NQUADS = /^<([^>]+)> <([^>]+)> <([^>]+)> <([^>]+)> \.$/;

function unquote(uri: string): string {
  return uri.replace(/^<| >$/g, "");
}

function isUri(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

function parseNtriplesLine(line: string): StoredQuad | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const uriMatch = trimmed.match(RE_NTRIPLES_URI);
  if (uriMatch) {
    return {
      subject: unquote(uriMatch[1]),
      predicate: unquote(uriMatch[2]),
      object: unquote(uriMatch[3]),
      graph: "",
    };
  }

  const bnodeMatch = trimmed.match(RE_NTRIPLES_BNODE);
  if (bnodeMatch) {
    return {
      subject: `_:${bnodeMatch[1]}`,
      predicate: unquote(bnodeMatch[2]),
      object: unquote(bnodeMatch[3]),
      graph: "",
    };
  }

  return null;
}

function parseNquadsLine(line: string): StoredQuad | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(RE_NQUADS);
  if (match) {
    return {
      subject: unquote(match[1]),
      predicate: unquote(match[2]),
      object: unquote(match[3]),
      graph: unquote(match[4]),
    };
  }

  return parseNtriplesLine(line);
}

export function parse(data: ArrayBuffer, contentType: ContentType): StoredQuad[] {
  const text = new TextDecoder().decode(data);
  const lines = text.split("\n");
  const quads: StoredQuad[] = [];

  for (const line of lines) {
    if (contentType === "application/n-quads" || contentType === "application/n-triples") {
      const q = parseNquadsLine(line);
      if (q) quads.push(q);
    } else if (contentType === "text/turtle" || contentType === "text/n3") {
      const q = parseNtriplesLine(line);
      if (q) quads.push(q);
    }
  }

  return quads;
}

function serializeQuad(q: StoredQuad, contentType: ContentType): string {
  const s = isUri(q.subject) ? `<${q.subject}>` : q.subject;
  const p = `<${q.predicate}>`;
  const o = isUri(q.object) ? `<${q.object}>` : q.object;

  if (contentType === "application/n-quads" && q.graph) {
    const g = `<${q.graph}>`;
    return `${s} ${p} ${o} ${g} .\n`;
  }

  return `${s} ${p} ${o} .\n`;
}

export function serialize(quads: StoredQuad[], contentType: ContentType): ArrayBuffer {
  const text = quads.map((q) => serializeQuad(q, contentType)).join("");
  return new TextEncoder().encode(text).buffer;
}