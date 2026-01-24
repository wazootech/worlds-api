/**
 * AccountRecord represents an account in the Worlds API.
 */
export interface AccountRecord {
  id: string;
  description?: string;
  plan?: string;
  apiKey: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/**
 * CreateAccountParams represents the parameters for creating an account.
 */
export type CreateAccountParams = Omit<
  AccountRecord,
  "apiKey" | "createdAt" | "updatedAt" | "deletedAt"
>;

/**
 * UpdateAccountParams represents the parameters for updating an account.
 */
export type UpdateAccountParams = Partial<CreateAccountParams>;

/**
 * InviteRecord represents an invite in the Worlds API.
 */
export interface InviteRecord {
  code: string;
  createdAt: number;
  redeemedBy?: string;
  redeemedAt?: number;
}

/**
 * CreateInviteParams represents the parameters for creating an invite.
 */
export interface CreateInviteParams {
  code?: string;
}
