import type { FactStorage, StoredFact } from "./interface.ts";
import { storedFactKey } from "./key.ts";

export class InMemoryFactStorage implements FactStorage {
  private readonly facts = new Map<string, StoredFact>();

  async setFact(fact: StoredFact): Promise<void> {
    this.facts.set(storedFactKey(fact), fact);
  }

  async deleteFact(fact: StoredFact): Promise<void> {
    this.facts.delete(storedFactKey(fact));
  }

  async setFacts(facts: StoredFact[]): Promise<void> {
    for (const q of facts) {
      this.facts.set(storedFactKey(q), q);
    }
  }

  async deleteFacts(facts: StoredFact[]): Promise<void> {
    for (const q of facts) {
      this.facts.delete(storedFactKey(q));
    }
  }

  async findFacts(matchers: StoredFact[]): Promise<StoredFact[]> {
    return Array.from(this.facts.values()).filter((stored) =>
      matchers.every((m) =>
        (!m.subject || m.subject === stored.subject) &&
        (!m.predicate || m.predicate === stored.predicate) &&
        (!m.object || m.object === stored.object) &&
        (!m.graph || m.graph === stored.graph)
      )
    );
  }

  async clear(): Promise<void> {
    this.facts.clear();
  }
}
