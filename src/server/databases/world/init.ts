import type { Client } from "@libsql/client";
import {
  chunksFtsDeleteTrigger,
  chunksFtsInsertTrigger,
  chunksFtsTable,
  chunksFtsUpdateTrigger,
  chunksPredicateIndex,
  chunksSubjectIndex,
  chunksTable,
  chunksTripleIdIndex,
  chunksVectorIndex,
} from "./chunks/queries.sql.ts";
import { triplesTable } from "./triples/queries.sql.ts";
import { worldDataTable } from "./world-data/queries.sql.ts";
import {
  logsTable,
  logsTimestampIndex,
  logsWorldIdIndex,
} from "./logs/queries.sql.ts";

/**
 * initializeWorldDatabase creates all world-specific tables and indexes if they don't exist.
 */
export async function initializeWorldDatabase(client: Client): Promise<void> {
  // Create tables
  await client.execute(chunksTable);
  await client.execute(chunksFtsTable);
  await client.execute(worldDataTable);
  await client.execute(triplesTable);
  await client.execute(logsTable);

  // Create indexes
  await client.execute(chunksTripleIdIndex);
  await client.execute(chunksSubjectIndex);
  await client.execute(chunksPredicateIndex);
  await client.execute(chunksVectorIndex);
  await client.execute(logsWorldIdIndex);
  await client.execute(logsTimestampIndex);

  // Create triggers
  await client.execute(chunksFtsInsertTrigger);
  await client.execute(chunksFtsDeleteTrigger);
  await client.execute(chunksFtsUpdateTrigger);
}
