import { WorldsSdk } from "@wazoo/sdk";
import type { AuthOrganization } from "./workos/org-management";

// Cache SDK instances per org to avoid recreating on every request
const sdkCache = new Map<string, WorldsSdk>();

export function getSdkForOrg(org: AuthOrganization): WorldsSdk {
  const cached = sdkCache.get(org.id);
  // Optional: check if cached config matches current org metadata just in case it rotated
  if (cached) return cached;

  const baseUrl = org.metadata?.apiBaseUrl;
  const apiKey = org.metadata?.apiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      `Organization ${org.id} is missing API configuration in metadata`,
    );
  }

  const sdk = new WorldsSdk({
    baseUrl,
    apiKey,
  });
  sdkCache.set(org.id, sdk);
  return sdk;
}
