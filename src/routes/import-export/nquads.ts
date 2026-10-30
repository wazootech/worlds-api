export interface QuadRow {
  subject: string;
  predicate: string;
  object: string;
  graph?: string;
}

export function quadToNQuad(quad: QuadRow) {
  const subject = namedNode(quad.subject);
  const predicate = namedNode(quad.predicate);
  const object = isNamedNodeValue(quad.object)
    ? namedNode(quad.object)
    : literal(quad.object);
  const graph = quad.graph ? ` ${namedNode(quad.graph)}` : "";
  return `${subject} ${predicate} ${object}${graph} .\n`;
}

function namedNode(value: string) {
  return `<${value.replace(/[<>]/g, "")}>`;
}

function literal(value: string) {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
}

function isNamedNodeValue(value: string) {
  return /^https?:\/\//.test(value) || /^urn:/.test(value);
}
