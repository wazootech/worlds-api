export type CredentialStatus = "active" | "invalid" | "revoked";

export type CredentialRow = {
  credential_id: string;
  namespace: string;
  provider: string;
  ciphertext: string | null;
  iv: string | null;
  kek_version: number;
  fingerprint: string;
  last4: string;
  status: CredentialStatus;
  consecutive_auth_failures: number;
  create_time: string;
  rotate_time: string | null;
  revoke_time: string | null;
};

/** Consecutive provider 401/403 results before a credential is marked invalid. */
export const AUTH_FAILURE_THRESHOLD = 3;
