/**
 * WorldsSdkOptions are the options for the Worlds API SDK.
 */
export interface WorldsSdkOptions {
  /**
   * baseUrl is the base URL of the Worlds API.
   */
  baseUrl: string;

  /**
   * apiKey is the API key for the Worlds API.
   */
  apiKey: string;

  /**
   * fetch fetches a resource from the network. It returns a `Promise` that
   * resolves to the `Response` to that `Request`, whether it is successful
   * or not.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Source is the ID of a source.
 */
export interface Source {
  /**
   * id is the ID of the source.
   */
  id: string;

  /**
   * writable is true if the source is writable.
   */
  writable?: boolean;

  /**
   * schema is true if the source contains schema information.
   */
  schema?: boolean;
}
