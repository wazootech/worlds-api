/**
 * Shared full-text tokenization and term-hit scoring for search (naive FTS and chunk search).
 */

export function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Count how many distinct query terms appear in subject, predicate, or object text.
 */
export function ftsTermHits(
  queryTerms: string[],
  subject: string,
  predicate: string,
  objectOrText: string,
): number {
  const subjectL = subject.toLowerCase();
  const predicateL = predicate.toLowerCase();
  const textL = objectOrText.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (
      subjectL.includes(term) ||
      predicateL.includes(term) ||
      textL.includes(term)
    ) {
      score++;
    }
  }
  return score;
}
