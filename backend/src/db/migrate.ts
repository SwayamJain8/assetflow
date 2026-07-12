import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "../config/db";

/**
 * Applies pending migrations at startup.
 *
 * This exists because `drizzle-kit migrate` is a DEV dependency: the production
 * image installs with --production, so the CLI is not there, and a fresh
 * `docker compose up` would come up serving an empty database. Migrating in
 * process needs only drizzle-orm, which is already a runtime dependency.
 *
 * The migrator is idempotent — it records what it has applied in
 * `__drizzle_migrations` and skips those — so restarting a container is safe.
 *
 * Honest limitation: two API containers starting at the same instant could both
 * try to apply the same migration. At that scale you want migrations as a
 * deploy step (an init container or a job), not as part of the app's boot. For a
 * single instance this is exactly right, and it makes `docker compose up` a
 * genuinely one-command start.
 */
export async function runMigrations(): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    console.log("Migrations up to date.");
  } catch (error) {
    console.error("Migration failed:", error);
    // A server running against a schema it does not understand is worse than one
    // that refuses to start: it would return 500s that look like application bugs.
    process.exit(1);
  }
}
