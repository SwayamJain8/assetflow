import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated into src/db/migrations and COMMITTED — they are the
 * schema's history and a reviewable artifact. Never use `drizzle-kit push` for
 * anything that reaches production; generate a migration and apply it.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
