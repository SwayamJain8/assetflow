import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

import { env, isProduction } from "./env";
import * as schema from "../db/schema";

/**
 * A single shared connection pool for the whole process. Creating a pool per
 * request would exhaust PostgreSQL's connection slots under load.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  console.error("Unexpected error on idle PostgreSQL client:", error);
});

export const db = drizzle(pool, {
  schema,
  logger: !isProduction,
});

/** Used by the health check and by startup to prove the DB is reachable. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (error) {
    console.error("Database ping failed:", error);
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export type Database = typeof db;
