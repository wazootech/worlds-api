import type { RateLimitPolicy } from "./interfaces.ts";

/**
 * ResourceType defines the types of resources that can be rate limited.
 */
export type ResourceType = "sparql_query" | "sparql_update" | "search";

/**
 * Policies defines the rate limit policies for different tiers.
 */
export const Policies: Record<string, Record<ResourceType, RateLimitPolicy>> = {
  free: {
    sparql_query: {
      interval: 60 * 1000, // 1 minute
      capacity: 60,
      refillRate: 60,
    },
    sparql_update: {
      interval: 60 * 1000, // 1 minute
      capacity: 10,
      refillRate: 10,
    },
    search: {
      interval: 60 * 1000, // 1 minute
      capacity: 60,
      refillRate: 60,
    },
  },
  pro: {
    sparql_query: {
      interval: 60 * 1000,
      capacity: 1000,
      refillRate: 1000,
    },
    sparql_update: {
      interval: 60 * 1000,
      capacity: 100,
      refillRate: 100,
    },
    search: {
      interval: 60 * 1000,
      capacity: 1000,
      refillRate: 1000,
    },
  },
};

/**
 * DefaultPolicy is the fallback policy if no plan is found.
 */
export const DefaultPolicy = Policies.free;

/**
 * getPolicy returns the policy for a given plan and resource.
 */
export function getPolicy(
  planName: string | null,
  resource: ResourceType,
): RateLimitPolicy {
  const plan = Policies[planName || "free"] || DefaultPolicy;
  return plan[resource] || DefaultPolicy[resource];
}
