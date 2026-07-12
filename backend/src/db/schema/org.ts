import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { entityStatus, userRole } from "./enums";

/**
 * The tenant root. Every core table carries `organization_id`, so the system is
 * multi-org from day one — retrofitting tenancy later means touching every query.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoPath: text("logo_path"),

  /**
   * Semantic design tokens generated from the uploaded logo (primary accent,
   * surfaces, and their light/dark variants). The frontend applies these as CSS
   * custom properties, so the whole app re-skins to the brand at runtime.
   */
  theme: jsonb("theme").$type<Record<string, string>>(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Departments form a hierarchy via `parent_department_id` pointing back at this
 * same table (Field Ops East → Field Ops).
 *
 * ON DELETE SET NULL on the parent: deleting a parent orphans its children into
 * top-level departments rather than cascading a whole org chart into oblivion.
 */
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    headUserId: uuid("head_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),

    parentDepartmentId: uuid("parent_department_id").references(
      (): AnyPgColumn => departments.id,
      { onDelete: "set null" },
    ),

    status: entityStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("departments_org_name_unique").on(t.organizationId, t.name),
    index("departments_org_idx").on(t.organizationId),
    index("departments_parent_idx").on(t.parentDepartmentId),
  ],
);

/**
 * Categories can define their own extra fields (e.g. Electronics wants a warranty
 * period). Stored as a jsonb array of `{ key, label, type }` descriptors; an
 * asset then fills them in via `assets.custom_values`. This keeps one flexible
 * schema instead of a table per category.
 */
export const assetCategories = pgTable(
  "asset_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),

    customFields: jsonb("custom_fields")
      .$type<Array<{ key: string; label: string; type: "text" | "number" | "date" }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("asset_categories_org_name_unique").on(t.organizationId, t.name),
    index("asset_categories_org_idx").on(t.organizationId),
  ],
);

/**
 * `role` defaults to `employee` at the database level. Self-elevation is
 * impossible by construction: the signup path never supplies a role, so even a
 * malicious payload cannot land anything but `employee` here.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),

    role: userRole("role").notNull().default("employee"),
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, {
      onDelete: "set null",
    }),
    status: entityStatus("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Email is unique per organization, not globally — two orgs may each have a
    // person at the same address.
    unique("users_org_email_unique").on(t.organizationId, t.email),
    index("users_org_idx").on(t.organizationId),
    index("users_department_idx").on(t.departmentId),
  ],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  departments: many(departments),
  assetCategories: many(assetCategories),
  users: many(users),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [departments.organizationId],
    references: [organizations.id],
  }),
  head: one(users, { fields: [departments.headUserId], references: [users.id] }),
  parent: one(departments, {
    fields: [departments.parentDepartmentId],
    references: [departments.id],
    relationName: "department_hierarchy",
  }),
  children: many(departments, { relationName: "department_hierarchy" }),
  members: many(users),
}));

export const assetCategoriesRelations = relations(assetCategories, ({ one }) => ({
  organization: one(organizations, {
    fields: [assetCategories.organizationId],
    references: [organizations.id],
  }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  department: one(departments, {
    fields: [users.departmentId],
    references: [departments.id],
  }),
}));
