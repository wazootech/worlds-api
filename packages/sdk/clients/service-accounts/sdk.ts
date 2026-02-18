import type { WorldsSdkOptions } from "../../options.ts";
import type {
  CreateServiceAccountParams,
  ServiceAccount,
  UpdateServiceAccountParams,
} from "./schema.ts";
import { parseError } from "../../utils.ts";

/**
 * ServiceAccounts is a client for managing service accounts via the Worlds API.
 */
export class ServiceAccounts {
  private readonly fetch: typeof fetch;

  public constructor(
    public readonly options: WorldsSdkOptions,
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /**
   * list lists all service accounts in an organization.
   */
  public async list(
    organizationId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<ServiceAccount[]> {
    const url = new URL(
      `${this.options.baseUrl}/v1/organizations/${organizationId}/service-accounts`,
    );
    if (options?.page) {
      url.searchParams.set("page", options.page.toString());
    }
    if (options?.pageSize) {
      url.searchParams.set("pageSize", options.pageSize.toString());
    }

    const response = await this.fetch(url, {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
    });
    if (!response.ok) {
      const errorMessage = await parseError(response);
      throw new Error(`Failed to list service accounts: ${errorMessage}`);
    }

    return await response.json();
  }

  /**
   * get gets a service account by ID.
   */
  public async get(
    organizationId: string,
    accountId: string,
  ): Promise<ServiceAccount | null> {
    const url = new URL(
      `${this.options.baseUrl}/v1/organizations/${organizationId}/service-accounts/${accountId}`,
    );

    const response = await this.fetch(url, {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const errorMessage = await parseError(response);
      throw new Error(`Failed to get service account: ${errorMessage}`);
    }

    return await response.json();
  }

  /**
   * create creates a service account.
   */
  public async create(
    organizationId: string,
    data: CreateServiceAccountParams,
  ): Promise<ServiceAccount> {
    const url = new URL(
      `${this.options.baseUrl}/v1/organizations/${organizationId}/service-accounts`,
    );

    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorMessage = await parseError(response);
      throw new Error(`Failed to create service account: ${errorMessage}`);
    }

    return await response.json();
  }

  /**
   * update updates a service account.
   */
  public async update(
    organizationId: string,
    accountId: string,
    data: UpdateServiceAccountParams,
  ): Promise<void> {
    const url = new URL(
      `${this.options.baseUrl}/v1/organizations/${organizationId}/service-accounts/${accountId}`,
    );

    const response = await this.fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorMessage = await parseError(response);
      throw new Error(`Failed to update service account: ${errorMessage}`);
    }
  }

  /**
   * delete deletes a service account.
   */
  public async delete(
    organizationId: string,
    accountId: string,
  ): Promise<void> {
    const url = new URL(
      `${this.options.baseUrl}/v1/organizations/${organizationId}/service-accounts/${accountId}`,
    );

    const response = await this.fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
    });
    if (!response.ok) {
      const errorMessage = await parseError(response);
      throw new Error(`Failed to delete service account: ${errorMessage}`);
    }
  }

  /**
   * rotateKey rotates the API key for a service account.
   */
  public async rotateKey(
    organizationId: string,
    accountId: string,
  ): Promise<{ apiKey: string }> {
    const url = new URL(
      `${this.options.baseUrl}/v1/organizations/${organizationId}/service-accounts/${accountId}/rotate`,
    );

    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
    });
    if (!response.ok) {
      const errorMessage = await parseError(response);
      throw new Error(`Failed to rotate service account key: ${errorMessage}`);
    }

    return await response.json();
  }
}
