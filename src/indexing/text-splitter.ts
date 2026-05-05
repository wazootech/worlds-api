/** LangChain-compatible defaults from prior worlds SearchIndexHandler. */
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 200;

/**
 * Recursive character splitter (simplified): split on paragraph, line, sentence, word, char.
 */
export function splitTextRecursive(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_OVERLAP,
): string[] {
  const separators = ["\n\n", "\n", ". ", ", ", " ", ""];
  return splitRecursive(text, separators, chunkSize, chunkOverlap);
}

function splitRecursive(
  text: string,
  separators: string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  if (text.length <= chunkSize) {
    return text.trim() ? [text] : [];
  }
  const sep = separators[0] ?? "";
  const rest = separators.slice(1);

  if (sep === "") {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
      const piece = text.slice(i, i + chunkSize).trim();
      if (piece) chunks.push(piece);
    }
    return chunks.length > 0 ? chunks : [];
  }

  const splits = text.split(sep);
  const chunks: string[] = [];
  let buf = "";

  for (const piece of splits) {
    const candidate = buf ? buf + sep + piece : piece;
    if (candidate.length <= chunkSize) {
      buf = candidate;
    } else {
      if (buf.trim()) {
        chunks.push(
          ...splitRecursive(buf.trim(), rest, chunkSize, chunkOverlap),
        );
      }
      buf = piece;
    }
  }
  if (buf.trim()) {
    chunks.push(...splitRecursive(buf.trim(), rest, chunkSize, chunkOverlap));
  }
  return chunks;
}
