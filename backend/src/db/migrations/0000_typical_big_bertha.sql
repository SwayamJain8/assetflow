CREATE TYPE "public"."asset_condition" AS ENUM('new', 'good', 'fair', 'poor', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('available', 'allocated', 'reserved', 'under_maintenance', 'lost', 'retired', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."audit_cycle_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."audit_item_status" AS ENUM('pending', 'verified', 'missing', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('upcoming', 'ongoing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('pending', 'approved', 'rejected', 'technician_assigned', 'in_progress', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('asset_assigned', 'maintenance_approved', 'maintenance_rejected', 'booking_confirmed', 'booking_cancelled', 'booking_reminder', 'transfer_approved', 'overdue_return', 'audit_discrepancy');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('requested', 'approved', 'rejected', 'reallocated');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'asset_manager', 'department_head', 'employee');--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_categories_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"head_user_id" uuid,
	"parent_department_id" uuid,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_path" text,
	"theme" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'employee' NOT NULL,
	"department_id" uuid,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_org_email_unique" UNIQUE("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"asset_tag" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"serial_number" text,
	"acquisition_date" date,
	"acquisition_cost" numeric(12, 2),
	"condition" "asset_condition" DEFAULT 'good' NOT NULL,
	"location" text,
	"department_id" uuid,
	"photo_path" text,
	"custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_bookable" boolean DEFAULT false NOT NULL,
	"status" "asset_status" DEFAULT 'available' NOT NULL,
	"retirement_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_org_tag_unique" UNIQUE("organization_id","asset_tag")
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"holder_user_id" uuid,
	"holder_department_id" uuid,
	"allocated_by" uuid,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_return_date" date,
	"returned_at" timestamp with time zone,
	"return_condition_notes" text,
	CONSTRAINT "allocation_has_a_holder" CHECK ("allocations"."holder_user_id" is not null or "allocations"."holder_department_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "transfer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid NOT NULL,
	"reason" text,
	"status" "transfer_status" DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"booked_by" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"purpose" text,
	"status" "booking_status" DEFAULT 'upcoming' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "booking_ends_after_it_starts" CHECK ("bookings"."ends_at" > "bookings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"reported_by" uuid,
	"issue_description" text NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"photo_path" text,
	"status" "maintenance_status" DEFAULT 'pending' NOT NULL,
	"technician_id" uuid,
	"approved_by" uuid,
	"rejection_reason" text,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_cycle_auditors" (
	"cycle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_cycle_auditors_cycle_id_user_id_pk" PRIMARY KEY("cycle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope_department_id" uuid,
	"scope_location" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "audit_cycle_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"expected_location" text,
	"status" "audit_item_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	CONSTRAINT "audit_items_cycle_asset_unique" UNIQUE("cycle_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_user_id_users_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_department_id_departments_id_fk" FOREIGN KEY ("parent_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_holder_department_id_departments_id_fk" FOREIGN KEY ("holder_department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_allocated_by_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resource_id_assets_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cycle_auditors" ADD CONSTRAINT "audit_cycle_auditors_cycle_id_audit_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."audit_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cycle_auditors" ADD CONSTRAINT "audit_cycle_auditors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cycles" ADD CONSTRAINT "audit_cycles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cycles" ADD CONSTRAINT "audit_cycles_scope_department_id_departments_id_fk" FOREIGN KEY ("scope_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cycles" ADD CONSTRAINT "audit_cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_cycle_id_audit_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."audit_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_categories_org_idx" ON "asset_categories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "departments_org_idx" ON "departments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "departments_parent_idx" ON "departments" USING btree ("parent_department_id");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "users_department_idx" ON "users" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "assets_org_idx" ON "assets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_category_idx" ON "assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "assets_department_idx" ON "assets" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "assets_serial_idx" ON "assets" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "assets_bookable_idx" ON "assets" USING btree ("is_bookable");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_allocation" ON "allocations" USING btree ("asset_id") WHERE "allocations"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "allocations_org_idx" ON "allocations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "allocations_asset_idx" ON "allocations" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "allocations_holder_user_idx" ON "allocations" USING btree ("holder_user_id");--> statement-breakpoint
CREATE INDEX "allocations_expected_return_idx" ON "allocations" USING btree ("expected_return_date");--> statement-breakpoint
CREATE INDEX "transfer_requests_org_idx" ON "transfer_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "transfer_requests_asset_idx" ON "transfer_requests" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "transfer_requests_status_idx" ON "transfer_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_org_idx" ON "bookings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bookings_resource_idx" ON "bookings" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "bookings_starts_at_idx" ON "bookings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "maintenance_org_idx" ON "maintenance_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "maintenance_asset_idx" ON "maintenance_requests" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_status_idx" ON "maintenance_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_cycles_org_idx" ON "audit_cycles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_cycles_status_idx" ON "audit_cycles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_items_cycle_idx" ON "audit_items" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "audit_items_status_idx" ON "audit_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_org_created_idx" ON "activity_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("type");--> statement-breakpoint

--
-- ─────────────────────────────────────────────────────────────────────────────
-- HAND-WRITTEN BLOCK — the parts Drizzle cannot express.
--
-- Safe to keep here: `drizzle-kit generate` diffs the schema against its own
-- JSON snapshot in meta/, NOT against the live database, so it never sees these
-- objects and will never drop them. (Never run `drizzle-kit push`, which does
-- diff the live DB and WOULD drop them.)
-- ─────────────────────────────────────────────────────────────────────────────
--

-- Required for the EXCLUDE constraint below: btree_gist lets a GiST index mix a
-- scalar equality operator (resource_id WITH =) with a range overlap operator
-- (during WITH &&) in a single constraint. Core GiST cannot do the scalar half.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

--
-- Asset tags (AF-0001) are minted by a PostgreSQL SEQUENCE, not by application
-- code. A read-max-then-increment in the service layer is a race: two concurrent
-- registrations both read AF-0007 and both try to write AF-0008. nextval() is
-- atomic, so collisions are impossible by construction.
--
CREATE SEQUENCE IF NOT EXISTS asset_tag_seq START 1;--> statement-breakpoint
ALTER TABLE "assets"
  ALTER COLUMN "asset_tag"
  SET DEFAULT 'AF-' || lpad(nextval('asset_tag_seq')::text, 4, '0');--> statement-breakpoint

--
-- ═══ SHOWPIECE: no two bookings of one resource may overlap ═══
--
-- `during` is a GENERATED column: PostgreSQL derives it from starts_at/ends_at on
-- every write. The application never inserts or updates it — it cannot drift out
-- of sync with the columns it is built from.
--
-- '[)' is a HALF-OPEN interval: start inclusive, end EXCLUSIVE. That is precisely
-- what the spec's example requires:
--
--     Room B2 booked 09:00–10:00
--       09:30–10:30  →  REJECTED   the ranges overlap
--       10:00–11:00  →  ACCEPTED   touching endpoints do NOT overlap
--
ALTER TABLE "bookings"
  ADD COLUMN "during" tstzrange
  GENERATED ALWAYS AS (tstzrange("starts_at", "ends_at", '[)')) STORED;--> statement-breakpoint

--
-- The constraint itself. PostgreSQL physically refuses to store a second booking
-- whose resource matches (WITH =) and whose time range overlaps (WITH &&) an
-- existing one. This holds under concurrency, which a SELECT-then-INSERT check in
-- application code never can — two simultaneous requests would both see the slot
-- as free and both write.
--
-- The WHERE predicate means a cancelled booking stops blocking its slot the
-- instant it is cancelled, without deleting the row: the history survives.
--
ALTER TABLE "bookings"
  ADD CONSTRAINT "no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    "during"      WITH &&
  ) WHERE ("status" <> 'cancelled');
