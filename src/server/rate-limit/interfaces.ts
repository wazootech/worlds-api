/**
 * RateLimitPolicy defines the rules for rate limiting a specific resource.
 */
export interface RateLimitPolicy {
  /**
   * interval is the time window in milliseconds for the token bucket refill.
   */
  interval: number;

  /**
   * capacity is the maximum number of tokens the bucket can hold.
   */
  capacity: number;

  /**
   * refillRate is the number of tokens added per interval.
   */
  refillRate: number;
}

/**
 * RateLimitResult contains the result of a rate limit check.
 */
export interface RateLimitResult {
  /**
   * allowed indicates if the request is allowed.
   */
  allowed: boolean;

  /**
   * remaining is the number of tokens remaining in the bucket.
   */
  remaining: number;

  /**
   * reset is the timestamp when the bucket will be fully refilled (or when the next token is available).
   */
  reset: number;
}

/**
 * RateLimiter defines the interface for consuming tokens.
 */
export interface RateLimiter {
  /**
   * consume attempts to consume tokens from a bucket.
   */
  consume(
    key: string,
    cost: number,
    policy: RateLimitPolicy,
  ): Promise<RateLimitResult>;
}
