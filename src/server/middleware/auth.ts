import type { AppContext } from "#/server/app-context.ts";

/**
 * AuthorizedRequest is the result of a successful authentication.
 */
export interface AuthorizedRequest {
  admin: boolean;
}

/**
 * authorizeRequest authorizes a request using Bearer token.
 * It strictly requires the Admin API Key.
 */
export function authorizeRequest(
  appContext: AppContext,
  request: Request,
): AuthorizedRequest {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { admin: false };
  }

  const apiKey = authHeader.slice("Bearer ".length).trim();

  if (apiKey === appContext.admin?.apiKey) {
    return { admin: true };
  }

  return { admin: false };
}
