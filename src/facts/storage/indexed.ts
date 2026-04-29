import type { FactStorage, StoredFact } from "./interface.ts";
import type { PatchHandler } from "#/facts/storage/index/types.ts";

export class IndexedFactStorage implements FactStorage {
  constructor(
    private readonly inner: FactStorage,
    private readonly handlers: PatchHandler[],
  ) {}

  async setFact(fact: StoredFact): Promise<void> {
    await this.inner.setFact(fact);
    const patch = { insertions: [fact], deletions: [] as StoredFact[] };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async deleteFact(fact: StoredFact): Promise<void> {
    await this.inner.deleteFact(fact);
    const patch = { insertions: [] as StoredFact[], deletions: [fact] };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async setFacts(facts: StoredFact[]): Promise<void> {
    if (facts.length === 0) return;
    await this.inner.setFacts(facts);
    const patch = { insertions: facts, deletions: [] as StoredFact[] };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async deleteFacts(facts: StoredFact[]): Promise<void> {
    if (facts.length === 0) return;
    await this.inner.deleteFacts(facts);
    const patch = { insertions: [] as StoredFact[], deletions: facts };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }

  async findFacts(matchers: StoredFact[]): Promise<StoredFact[]> {
    return this.inner.findFacts(matchers);
  }

  async clear(): Promise<void> {
    const existing = await this.inner.findFacts([]);
    await this.inner.clear();
    if (existing.length === 0) return;
    const patch = { insertions: [] as StoredFact[], deletions: existing };
    await Promise.all(this.handlers.map((h) => h.patch([patch])));
  }
}
