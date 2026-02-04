import type { AppContext } from "#/server/app-context.ts";
import { RateLimitsService } from "#/server/databases/core/rate-limits/service.ts";

/**
 * RateLimitOptions configuration for the rate limiter.
 */
export interface RateLimitOptions {
  limit: number;
  period: number;
}

/**
 * rateLimiter creates a rate limiting middleware.
 */
export function rateLimiter(options: RateLimitOptions) {
  return async (
    request: Request,
    ctx: AppContext,
  ): Promise<Response | null> => {
    // Identify the user or tenant
    // For now, we'll use the IP address as a fallback if no auth header is present,
    // or the API key hash if authenticated.
    // In a real scenario with auth, we'd use the tenant ID or user ID from the auth context.
    const authHeader = request.headers.get("Authorization");
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown";

    let key = `ip:${ip}`;
    if (authHeader) {
      // Simple hash of the auth header to avoid storing sensitive keys directly if logged
      // But for rate limiting key, we can just use a prefix
      // Ideally we would extract the ID from the validated token/key
      key = `auth:${authHeader.slice(-8)}`; // Use last 8 chars as proxy identity
    }

    try {
      const rateLimitsService = new RateLimitsService(ctx.database);
      const result = await rateLimitsService.checkLimit(
        key,
        options.limit,
        options.period,
      );

      // Set RateLimit headers
      const headers = new Headers();
      headers.set("X-RateLimit-Limit", options.limit.toString());
      headers.set("X-RateLimit-Remaining", result.remaining.toString());
      headers.set(
        "X-RateLimit-Reset",
        Math.ceil(result.reset / 1000).toString(),
      );

      if (!result.allowed) {
        return new Response("Too Many Requests", {
          status: 429,
          headers,
        });
      }

      // If allowed, we don't return a response, allowing the next handler to run.
      // But since we can't easily modify the response headers of the *next* handler here
      // without a proper middleware chain that supports post-processing,
      // we might need to rely on the framework or adapt this pattern.
      // For now, we return null to indicate "proceed".
      // The headers are unfortunately lost for successful requests unless we attach them to the context
      // or if the router supports modifying response headers.
      // Given the simple router, we'll just focus on blocking.

      return null;
    } catch (error) {
      console.error("Rate limit error:", error);
      // Fail open if rate limiter fails
      return null;
    }
  };
}
