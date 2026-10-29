import type { Env } from "../../../env";
import { execute, getDb, query, queryOne } from "../../db";
import { getEmbeddingModel, type EmbeddingProviderId } from "../catalog";
import { AUTH_FAILURE_THRESHOLD, type CredentialRow } from "./credential-types";

export async function getCredential(
  env: Env,
  namespace: string,
  provider: EmbeddingProviderId,
): Promise<CredentialRow | null> {
  return queryOne<CredentialRow>(
    getDb(env),
    "SELECT * FROM embedding_credentials WHERE namespace = ? AND provider = ?",
    [namespace, provider],
  );
}

/** Every credential row the namespace holds, newest first (revoked included). */
export async function listCredentials(
  env: Env,
  namespace: string,
): Promise<CredentialRow[]> {
  return (
    (await query<CredentialRow>(
      getDb(env),
      "SELECT * FROM embedding_credentials WHERE namespace = ? ORDER BY create_time DESC",
      [namespace],
    )) ?? []
  );
}

/**
 * The namespace's credential for the provider that serves `modelId`, or null
 * when the model is not allowlisted or the namespace has no credential for it.
 */
export async function getCredentialForModel(
  env: Env,
  namespace: string,
  modelId: string,
): Promise<CredentialRow | null> {
  const provider = getEmbeddingModel(modelId)?.provider;
  return provider ? getCredential(env, namespace, provider) : null;
}

export async function recordAuthFailure(
  env: Env,
  credentialId: string,
): Promise<void> {
  await execute(
    getDb(env),
    `UPDATE embedding_credentials
       SET consecutive_auth_failures = consecutive_auth_failures + 1,
           status = CASE WHEN consecutive_auth_failures + 1 >= ? THEN 'invalid' ELSE status END
     WHERE credential_id = ? AND status = 'active'`,
    [AUTH_FAILURE_THRESHOLD, credentialId],
  );
}

export async function recordAuthSuccess(
  env: Env,
  credentialId: string,
): Promise<void> {
  await execute(
    getDb(env),
    "UPDATE embedding_credentials SET consecutive_auth_failures = 0 WHERE credential_id = ? AND consecutive_auth_failures > 0",
    [credentialId],
  );
}
