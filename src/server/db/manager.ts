import type { Client } from "@libsql/client";

/**
 * LibsqlManager manages LibSQL databases.
 */
export interface LibsqlManager {
  /**
   * create creates a new LibSQL database.
   */
  create(id: string): Promise<Client>;

  /**
   * get returns the LibSQL database for the given id.
   */
  get(id: string): Promise<Client>;

  /**
   * delete deletes the LibSQL database for the given id.
   */
  delete(id: string): Promise<void>;
}
