/**
 * Realistic seed data — run with `bun run db:seed`.
 *
 * This exists to satisfy the "real, dynamic data" requirement, but its real job
 * is to make the two scenarios from the spec reproducible on a fresh clone. The
 * literals below are deliberate and MUST NOT be renamed:
 *
 *   AF-0114  "MacBook Pro 14"  held by Priya Sharma  → the double-allocation block
 *   "Room B2"  booked today 09:00–10:00              → the booking-overlap reject
 *
 * Room B2 is also deliberately left FREE from 10:00–11:00, because the demo books
 * exactly that slot to prove a back-to-back booking is legal (the half-open range).
 *
 * Everything else is here to make the org look like a company rather than a test
 * fixture: 10 departments, 22 people, 52 assets, a year of maintenance history and
 * three weeks of past bookings, so every chart has a real shape instead of one bar.
 *
 * INVARIANTS THIS FILE UPHOLDS (breaking one makes the app contradict itself):
 *   · An asset with status 'allocated' has exactly one OPEN allocation, and no
 *     other asset status has one. The allocations are DERIVED from the asset rows
 *     below rather than typed twice, so the two cannot drift apart.
 *   · An asset is 'under_maintenance' only if it has an approved / assigned /
 *     in-progress request. A *pending* request leaves the asset alone — that is the
 *     entire point of the approval gate.
 *   · No two bookings of one resource overlap. If that ever slips, the seed does not
 *     silently produce bad data — the exclusion constraint aborts it.
 *
 * Idempotent: truncates everything, then rebuilds. Safe to run repeatedly.
 */
import { sql } from "drizzle-orm";

import { closeDatabase, db } from "../config/db";
import { env } from "../config/env";
import * as s from "./schema";

const PASSWORD = "password123";

/**
 * Seeded times are built in the ORGANIZATION'S timezone, never the process's.
 *
 * `new Date().setHours(9)` means "09:00 wherever this code happens to be running".
 * On a laptop that is IST; inside the Docker container it is UTC. Seeding from the
 * container therefore stored Room B2's "09:00–10:00" booking as 09:00 UTC, which a
 * user in India sees as 14:30 — and the spec's headline scenario silently stops
 * being about 9am.
 *
 * The helpers below pin every seeded time to APP_TIMEZONE, so `docker compose exec
 * api bun run db:seed` and `bun run db:seed` on the host produce identical data.
 */
const TZ = env.APP_TIMEZONE;

/**
 * The calendar fields of `instant`, as read in `zone`.
 *
 * Built from formatToParts with explicit numeric options rather than a locale's
 * date string. Bun's Alpine image ships a trimmed ICU, so an "en-CA" format that
 * yields YYYY-MM-DD on a laptop can silently fall back to M/D/YYYY in the
 * container — which then parses as an invalid Date. Numeric parts are locale-proof.
 */
function partsIn(instant: Date, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some ICU builds render midnight as "24" rather than "00".
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** How far `zone` is ahead of UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const p = partsIn(instant, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime();
}

/** Today (± offsetDays) as YYYY-MM-DD *in the org's timezone*. */
function todayInZone(offsetDays = 0): string {
  const p = partsIn(new Date(Date.now() + offsetDays * 86_400_000), TZ);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The instant at which it is `hour:minute` on `dayOffset` days from today, in the org's timezone. */
function dayAt(dayOffset: number, hour: number, minute = 0): Date {
  const p = partsIn(new Date(Date.now() + dayOffset * 86_400_000), TZ);

  // The wall-clock time we want, read as if it were UTC…
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);

  // …then shifted back by the zone's offset, giving the instant at which the zone
  // actually reads that wall-clock time.
  return new Date(asIfUtc - zoneOffsetMs(new Date(asIfUtc), TZ));
}

/** The instant at which it is `hour:minute` TODAY in the org's timezone. */
const todayAt = (hour: number, minute = 0): Date => dayAt(0, hour, minute);

const daysFromNow = (days: number): string => todayInZone(days);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000);

// ── Locations (a company has a handful of real places, not free text) ────────
const BLR_1 = "Bengaluru HQ · Floor 1";
const BLR_2 = "Bengaluru HQ · Floor 2";
const BLR_3 = "Bengaluru HQ · Floor 3";
const PUNE = "Pune Office";
const WAREHOUSE = "Warehouse · Whitefield";
const FIELD = "Field · East Region";

async function seed() {
  console.log("Seeding AssetFlow…\n");

  // ── Reset ────────────────────────────────────────────────────────────────
  // CASCADE follows the FKs, so truncating organizations empties everything.
  // RESTART IDENTITY resets the asset-tag sequence too.
  await db.execute(sql`
    TRUNCATE TABLE
      organizations, departments, asset_categories, users, assets,
      allocations, transfer_requests, bookings, maintenance_requests,
      audit_cycles, audit_cycle_auditors, audit_items,
      notifications, activity_logs
    RESTART IDENTITY CASCADE
  `);

  const passwordHash = await Bun.password.hash(PASSWORD);

  // ── Organization ─────────────────────────────────────────────────────────
  const [org] = await db
    .insert(s.organizations)
    .values({
      name: "Acme Corp",
      slug: "acme",
      // Default theme. Overwritten the moment an admin uploads a logo.
      theme: { primary: "#14b8a6", accent: "#8b5cf6" },
    })
    .returning();
  const orgId = org!.id;

  // ── Departments ──────────────────────────────────────────────────────────
  // Two real hierarchies: Platform and QA sit under Engineering; Field Ops (East)
  // sits under Field Ops. That is the self-referential parent_department_id doing
  // its job — a flat list would not prove the column exists.
  const [engineering, facilities, fieldOps, design, finance, sales] = await db
    .insert(s.departments)
    .values([
      { organizationId: orgId, name: "Engineering" },
      { organizationId: orgId, name: "Facilities" },
      { organizationId: orgId, name: "Field Ops" },
      { organizationId: orgId, name: "Design" },
      { organizationId: orgId, name: "Finance" },
      { organizationId: orgId, name: "Sales" },
    ])
    .returning();

  const [platform, qa, fieldOpsEast] = await db
    .insert(s.departments)
    .values([
      { organizationId: orgId, name: "Platform", parentDepartmentId: engineering!.id },
      { organizationId: orgId, name: "Quality Assurance", parentDepartmentId: engineering!.id },
      { organizationId: orgId, name: "Field Ops (East)", parentDepartmentId: fieldOps!.id },
      // Inactive: the team was folded into Facilities. Kept, not deleted — its assets
      // and its history still have to point somewhere.
      { organizationId: orgId, name: "Support Desk", parentDepartmentId: facilities!.id, status: "inactive" },
    ])
    .returning();

  // ── People ───────────────────────────────────────────────────────────────
  // Every role is represented so a judge can log in as each and see RBAC work.
  // The four accounts named in the README are the first four; the rest make the
  // directory, the department sizes and the reports look like a real company.
  const userRows = [
    { name: "Ananya Desai", email: "admin@acme.test", role: "admin" as const, departmentId: null },
    { name: "Raj Verma", email: "raj@acme.test", role: "asset_manager" as const, departmentId: engineering!.id },
    { name: "Priya Sharma", email: "priya@acme.test", role: "employee" as const, departmentId: engineering!.id },
    { name: "Aditi Rao", email: "aditi@acme.test", role: "department_head" as const, departmentId: engineering!.id },

    { name: "Rohan Mehta", email: "rohan@acme.test", role: "department_head" as const, departmentId: facilities!.id },
    { name: "Sana Iqbal", email: "sana@acme.test", role: "employee" as const, departmentId: fieldOps!.id },
    { name: "Arjun Nair", email: "arjun@acme.test", role: "employee" as const, departmentId: platform!.id },
    { name: "Vikram Singh", email: "vikram@acme.test", role: "employee" as const, departmentId: facilities!.id },

    { name: "Meera Krishnan", email: "meera@acme.test", role: "asset_manager" as const, departmentId: facilities!.id },
    { name: "Kabir Shah", email: "kabir@acme.test", role: "employee" as const, departmentId: platform!.id },
    { name: "Farhan Qureshi", email: "farhan@acme.test", role: "employee" as const, departmentId: qa!.id },
    { name: "Tanvi Joshi", email: "tanvi@acme.test", role: "department_head" as const, departmentId: qa!.id },

    { name: "Divya Menon", email: "divya@acme.test", role: "department_head" as const, departmentId: finance!.id },
    { name: "Zoya Ansari", email: "zoya@acme.test", role: "employee" as const, departmentId: finance!.id },
    { name: "Lakshmi Iyer", email: "lakshmi@acme.test", role: "department_head" as const, departmentId: sales!.id },
    { name: "Karan Bhatia", email: "karan@acme.test", role: "employee" as const, departmentId: sales!.id },

    { name: "Neha Gupta", email: "neha@acme.test", role: "department_head" as const, departmentId: design!.id },
    { name: "Dev Patel", email: "dev@acme.test", role: "employee" as const, departmentId: design!.id },
    { name: "Imran Sheikh", email: "imran@acme.test", role: "employee" as const, departmentId: fieldOpsEast!.id },
    { name: "Harsh Kulkarni", email: "harsh@acme.test", role: "employee" as const, departmentId: facilities!.id },
    { name: "Nikhil Rane", email: "nikhil@acme.test", role: "employee" as const, departmentId: fieldOpsEast!.id },

    // Left the company. Deactivated, not deleted — her allocation history is still
    // referenced by assets that came back, and deleting her would orphan it.
    { name: "Ishita Roy", email: "ishita@acme.test", role: "employee" as const, departmentId: platform!.id, status: "inactive" as const },
  ];

  const users = await db
    .insert(s.users)
    .values(userRows.map((u) => ({ ...u, organizationId: orgId, passwordHash })))
    .returning();

  const byEmail = new Map(users.map((u) => [u.email, u]));
  const U = (email: string) => byEmail.get(`${email}@acme.test`)!;

  const admin = U("admin");
  const raj = U("raj");
  const priya = U("priya");
  const aditi = U("aditi");
  const rohan = U("rohan");
  const sana = U("sana");
  const arjun = U("arjun");
  const vikram = U("vikram");

  // Department heads (circular FK — must be set after the users exist).
  const heads: Array<[string, string]> = [
    [engineering!.id, aditi.id],
    [facilities!.id, rohan.id],
    [fieldOps!.id, sana.id],
    [design!.id, U("neha").id],
    [finance!.id, U("divya").id],
    [sales!.id, U("lakshmi").id],
    [qa!.id, U("tanvi").id],
    [platform!.id, U("arjun").id],
    [fieldOpsEast!.id, U("imran").id],
  ];
  for (const [deptId, headId] of heads) {
    await db.update(s.departments).set({ headUserId: headId }).where(sql`id = ${deptId}`);
  }

  // ── Categories ───────────────────────────────────────────────────────────
  // Three of the six carry category-specific custom fields — a laptop needs a
  // warranty, a van needs a registration number, a room needs a seat count. That
  // is the whole reason categories own a `custom_fields` jsonb rather than the
  // assets table growing a column for every category anyone ever invents.
  const [electronics, furniture, vehicles, rooms, networking, tools] = await db
    .insert(s.assetCategories)
    .values([
      {
        organizationId: orgId,
        name: "Electronics",
        description: "Laptops, monitors, projectors, cameras",
        customFields: [
          { key: "warrantyMonths", label: "Warranty (months)", type: "number" },
          { key: "supplier", label: "Supplier", type: "text" },
        ],
      },
      { organizationId: orgId, name: "Furniture", description: "Desks, chairs, cabinets, whiteboards" },
      {
        organizationId: orgId,
        name: "Vehicles",
        description: "Vans, cars, forklifts",
        customFields: [
          { key: "registration", label: "Registration number", type: "text" },
          { key: "insuranceExpiry", label: "Insurance expiry", type: "date" },
        ],
      },
      {
        organizationId: orgId,
        name: "Rooms",
        description: "Bookable meeting and training spaces",
        customFields: [{ key: "capacity", label: "Seats", type: "number" }],
      },
      { organizationId: orgId, name: "Networking", description: "Switches, routers, access points" },
      { organizationId: orgId, name: "Tools & Equipment", description: "Power tools, ladders, safety gear" },
    ])
    .returning();

  // ── Assets ───────────────────────────────────────────────────────────────
  // `holder` / `holderDept` are NOT columns — they are read below to DERIVE the
  // allocations, so an asset marked 'allocated' cannot end up without an open
  // allocation row (which would let the app claim it is held by nobody).
  type Row = {
    assetTag: string;
    name: string;
    categoryId: string;
    status: "available" | "allocated" | "reserved" | "under_maintenance" | "lost" | "retired" | "disposed";
    location: string;
    departmentId: string;
    serialNumber?: string;
    acquisitionCost?: string;
    acquisitionDate?: string;
    condition?: "new" | "good" | "fair" | "poor" | "damaged";
    isBookable?: boolean;
    retirementDate?: string;
    customValues?: Record<string, unknown>;
    holder?: string; // email prefix — becomes an open allocation
    holderDept?: string; // department id — an asset held by a team, not a person
    heldForDays?: number;
    dueInDays?: number; // negative ⇒ overdue
  };

  const assetRows: Row[] = [
    // ★ Scenario #1. Held by Priya. Allocating it to anyone else must be refused.
    { assetTag: "AF-0114", name: "MacBook Pro 14", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: engineering!.id, serialNumber: "C02XY1114", acquisitionCost: "185000.00", acquisitionDate: "2024-03-12", condition: "good", customValues: { warrantyMonths: 24, supplier: "Apple India" }, holder: "priya", heldForDays: 28, dueInDays: 30 },

    // ★ Scenario #2. Booked today 09:00–10:00 below; 10:00–11:00 deliberately free.
    { assetTag: "AF-0500", name: "Room B2", categoryId: rooms!.id, status: "available", location: BLR_2, departmentId: facilities!.id, isBookable: true, condition: "good", customValues: { capacity: 8 } },

    // The rest of the bookable estate, so the booking screen has a real picker.
    { assetTag: "AF-0501", name: "Room A1", categoryId: rooms!.id, status: "available", location: BLR_1, departmentId: facilities!.id, isBookable: true, condition: "good", customValues: { capacity: 4 } },
    { assetTag: "AF-0502", name: "Room C3", categoryId: rooms!.id, status: "available", location: BLR_3, departmentId: facilities!.id, isBookable: true, condition: "good", customValues: { capacity: 6 } },
    { assetTag: "AF-0503", name: "Board Room", categoryId: rooms!.id, status: "available", location: BLR_3, departmentId: facilities!.id, isBookable: true, condition: "new", customValues: { capacity: 20 } },
    { assetTag: "AF-0504", name: "Training Room", categoryId: rooms!.id, status: "available", location: PUNE, departmentId: facilities!.id, isBookable: true, condition: "good", customValues: { capacity: 30 } },
    { assetTag: "AF-0343", name: "Delivery Van", categoryId: vehicles!.id, status: "available", location: WAREHOUSE, departmentId: fieldOps!.id, isBookable: true, acquisitionCost: "1250000.00", acquisitionDate: "2022-06-01", condition: "fair", customValues: { registration: "KA-01-AB-4412", insuranceExpiry: "2026-03-31" } },
    { assetTag: "AF-0344", name: "Company Car (Innova)", categoryId: vehicles!.id, status: "available", location: BLR_1, departmentId: sales!.id, isBookable: true, acquisitionCost: "2450000.00", acquisitionDate: "2023-01-18", condition: "good", customValues: { registration: "KA-05-MH-7781", insuranceExpiry: "2026-01-18" } },

    // ── Laptops & workstations — the bulk of any company's register ─────────
    { assetTag: "AF-0012", name: "Dell Latitude 7440", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: engineering!.id, serialNumber: "DL7440-012", acquisitionCost: "95000.00", acquisitionDate: "2024-01-20", condition: "good", customValues: { warrantyMonths: 36, supplier: "Dell" }, holder: "arjun", heldForDays: 45, dueInDays: 14 },
    { assetTag: "AF-0013", name: "MacBook Air M3", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: design!.id, serialNumber: "C02AI3013", acquisitionCost: "134000.00", acquisitionDate: "2024-07-04", condition: "new", customValues: { warrantyMonths: 24, supplier: "Apple India" }, holder: "neha", heldForDays: 20, dueInDays: 60 },
    { assetTag: "AF-0014", name: "MacBook Pro 16", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: design!.id, serialNumber: "C02XZ4014", acquisitionCost: "265000.00", acquisitionDate: "2024-02-27", condition: "good", customValues: { warrantyMonths: 24, supplier: "Apple India" }, holder: "dev", heldForDays: 65, dueInDays: 40 },
    { assetTag: "AF-0015", name: "ThinkPad T14", categoryId: electronics!.id, status: "allocated", location: PUNE, departmentId: qa!.id, serialNumber: "TP-T14-015", acquisitionCost: "88000.00", acquisitionDate: "2023-10-09", condition: "good", customValues: { warrantyMonths: 36, supplier: "Lenovo" }, holder: "farhan", heldForDays: 90, dueInDays: 25 },
    { assetTag: "AF-0016", name: "ThinkPad T14", categoryId: electronics!.id, status: "allocated", location: PUNE, departmentId: qa!.id, serialNumber: "TP-T14-016", acquisitionCost: "88000.00", acquisitionDate: "2023-10-09", condition: "fair", customValues: { warrantyMonths: 36, supplier: "Lenovo" }, holder: "tanvi", heldForDays: 88, dueInDays: 25 },
    { assetTag: "AF-0017", name: "HP EliteBook 840", categoryId: electronics!.id, status: "allocated", location: BLR_1, departmentId: finance!.id, serialNumber: "HP840-017", acquisitionCost: "92000.00", acquisitionDate: "2023-05-22", condition: "good", customValues: { warrantyMonths: 24, supplier: "HP" }, holder: "divya", heldForDays: 120, dueInDays: 10 },
    { assetTag: "AF-0018", name: "HP EliteBook 840", categoryId: electronics!.id, status: "allocated", location: BLR_1, departmentId: finance!.id, serialNumber: "HP840-018", acquisitionCost: "92000.00", acquisitionDate: "2023-05-22", condition: "good", customValues: { warrantyMonths: 24, supplier: "HP" }, holder: "zoya", heldForDays: 118, dueInDays: 12 },
    { assetTag: "AF-0019", name: "Dell XPS 15", categoryId: electronics!.id, status: "allocated", location: BLR_1, departmentId: sales!.id, serialNumber: "DX15-019", acquisitionCost: "165000.00", acquisitionDate: "2024-04-16", condition: "good", customValues: { warrantyMonths: 24, supplier: "Dell" }, holder: "lakshmi", heldForDays: 35, dueInDays: 45 },
    { assetTag: "AF-0020", name: "ThinkPad X1 Carbon", categoryId: electronics!.id, status: "available", location: BLR_2, departmentId: platform!.id, serialNumber: "TP-X1-020", acquisitionCost: "140000.00", acquisitionDate: "2021-06-30", condition: "fair", customValues: { warrantyMonths: 36, supplier: "Lenovo" }, retirementDate: daysFromNow(20) },

    // OVERDUE — due 3 days ago and still out. This is what the red dashboard banner
    // and the overdue-returns cron job both key off.
    { assetTag: "AF-0021", name: "iPad Pro 12.9", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: engineering!.id, serialNumber: "IP-0021", acquisitionCost: "120000.00", acquisitionDate: "2023-09-14", condition: "good", customValues: { warrantyMonths: 12, supplier: "Apple India" }, holder: "vikram", heldForDays: 40, dueInDays: -3 },
    // OVERDUE — a second one, worse, so the banner has a list rather than a single row.
    { assetTag: "AF-0022", name: "Surface Pro 9", categoryId: electronics!.id, status: "allocated", location: FIELD, departmentId: fieldOpsEast!.id, serialNumber: "SP9-0022", acquisitionCost: "110000.00", acquisitionDate: "2023-12-02", condition: "fair", customValues: { warrantyMonths: 24, supplier: "Microsoft" }, holder: "imran", heldForDays: 62, dueInDays: -9 },
    { assetTag: "AF-0023", name: "Rugged Field Laptop", categoryId: electronics!.id, status: "allocated", location: FIELD, departmentId: fieldOps!.id, serialNumber: "RF-0023", acquisitionCost: "175000.00", acquisitionDate: "2022-11-11", condition: "fair", customValues: { warrantyMonths: 36, supplier: "Panasonic" }, holder: "sana", heldForDays: 200, dueInDays: 30 },
    { assetTag: "AF-0024", name: "Mac Mini M2", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: platform!.id, serialNumber: "MM2-0024", acquisitionCost: "72000.00", acquisitionDate: "2024-06-08", condition: "new", customValues: { warrantyMonths: 12, supplier: "Apple India" }, holder: "kabir", heldForDays: 15, dueInDays: 90 },

    // ── Peripherals & AV ───────────────────────────────────────────────────
    { assetTag: "AF-0033", name: "Conference Speakerphone", categoryId: electronics!.id, status: "allocated", location: BLR_1, departmentId: facilities!.id, acquisitionCost: "22000.00", acquisitionDate: "2023-11-30", condition: "good", holderDept: facilities!.id, heldForDays: 60 },
    { assetTag: "AF-0055", name: "HP LaserJet Printer", categoryId: electronics!.id, status: "under_maintenance", location: BLR_2, departmentId: facilities!.id, acquisitionCost: "35000.00", acquisitionDate: "2023-07-07", condition: "good" },
    { assetTag: "AF-0062", name: "Epson Projector", categoryId: electronics!.id, status: "available", location: BLR_2, departmentId: facilities!.id, serialNumber: "EP-0062", acquisitionCost: "48000.00", acquisitionDate: "2023-08-15", condition: "poor" },
    { assetTag: "AF-0063", name: "BenQ Projector", categoryId: electronics!.id, status: "available", location: BLR_3, departmentId: facilities!.id, serialNumber: "BQ-0063", acquisitionCost: "52000.00", acquisitionDate: "2024-02-19", condition: "good" },
    { assetTag: "AF-0088", name: "Dell UltraSharp 27\"", categoryId: electronics!.id, status: "under_maintenance", location: BLR_2, departmentId: engineering!.id, serialNumber: "DU-0088", acquisitionCost: "45000.00", acquisitionDate: "2024-02-08", condition: "damaged" },
    { assetTag: "AF-0089", name: "Dell UltraSharp 27\"", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: engineering!.id, serialNumber: "DU-0089", acquisitionCost: "45000.00", acquisitionDate: "2024-02-08", condition: "good", holder: "priya", heldForDays: 28, dueInDays: 30 },
    { assetTag: "AF-0090", name: "LG UltraFine 4K", categoryId: electronics!.id, status: "available", location: BLR_2, departmentId: design!.id, acquisitionCost: "62000.00", acquisitionDate: "2024-05-30", condition: "new" },
    { assetTag: "AF-0140", name: "Logitech MX Webcam", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: platform!.id, acquisitionCost: "12000.00", acquisitionDate: "2024-04-03", condition: "good", holder: "kabir", heldForDays: 12, dueInDays: 7 },
    { assetTag: "AF-0141", name: "Wacom Intuos Tablet", categoryId: electronics!.id, status: "allocated", location: BLR_2, departmentId: design!.id, acquisitionCost: "28000.00", acquisitionDate: "2024-03-21", condition: "good", holder: "dev", heldForDays: 55, dueInDays: 35 },
    { assetTag: "AF-0301", name: "Canon EOS R6", categoryId: electronics!.id, status: "available", location: WAREHOUSE, departmentId: design!.id, acquisitionCost: "178000.00", acquisitionDate: "2022-12-01", condition: "good" },
    { assetTag: "AF-0302", name: "Rode Wireless Mic Kit", categoryId: electronics!.id, status: "available", location: BLR_3, departmentId: design!.id, acquisitionCost: "31000.00", acquisitionDate: "2023-06-14", condition: "good" },
    { assetTag: "AF-0335", name: "Portable Projector", categoryId: electronics!.id, status: "reserved", location: BLR_1, departmentId: facilities!.id, acquisitionCost: "30000.00", acquisitionDate: "2024-01-05", condition: "good" },
    { assetTag: "AF-0336", name: "Event PA System", categoryId: electronics!.id, status: "reserved", location: WAREHOUSE, departmentId: facilities!.id, acquisitionCost: "84000.00", acquisitionDate: "2023-03-09", condition: "good" },

    // ── Networking ─────────────────────────────────────────────────────────
    { assetTag: "AF-0601", name: "Cisco Catalyst Switch", categoryId: networking!.id, status: "allocated", location: BLR_1, departmentId: platform!.id, serialNumber: "CS-0601", acquisitionCost: "210000.00", acquisitionDate: "2022-04-25", condition: "good", holderDept: platform!.id, heldForDays: 300 },
    { assetTag: "AF-0602", name: "Ubiquiti Access Point", categoryId: networking!.id, status: "allocated", location: BLR_2, departmentId: platform!.id, acquisitionCost: "18000.00", acquisitionDate: "2023-02-14", condition: "good", holderDept: platform!.id, heldForDays: 280 },
    { assetTag: "AF-0603", name: "Ubiquiti Access Point", categoryId: networking!.id, status: "available", location: WAREHOUSE, departmentId: platform!.id, acquisitionCost: "18000.00", acquisitionDate: "2023-02-14", condition: "new" },
    { assetTag: "AF-0604", name: "APC UPS 3kVA", categoryId: networking!.id, status: "available", location: BLR_1, departmentId: facilities!.id, acquisitionCost: "96000.00", acquisitionDate: "2021-09-30", condition: "fair", retirementDate: daysFromNow(50) },

    // ── Furniture ──────────────────────────────────────────────────────────
    { assetTag: "AF-0201", name: "Ergonomic Office Chair", categoryId: furniture!.id, status: "available", location: WAREHOUSE, departmentId: facilities!.id, acquisitionCost: "18000.00", acquisitionDate: "2024-05-02", condition: "new" },
    { assetTag: "AF-0202", name: "Standing Desk", categoryId: furniture!.id, status: "available", location: WAREHOUSE, departmentId: facilities!.id, acquisitionCost: "32000.00", acquisitionDate: "2024-05-02", condition: "new" },
    { assetTag: "AF-0203", name: "Standing Desk", categoryId: furniture!.id, status: "allocated", location: BLR_2, departmentId: engineering!.id, acquisitionCost: "32000.00", acquisitionDate: "2024-05-02", condition: "good", holder: "aditi", heldForDays: 70 },
    { assetTag: "AF-0204", name: "Filing Cabinet", categoryId: furniture!.id, status: "allocated", location: BLR_1, departmentId: finance!.id, acquisitionCost: "14000.00", acquisitionDate: "2022-08-08", condition: "fair", holderDept: finance!.id, heldForDays: 400 },
    { assetTag: "AF-0410", name: "Meeting Room Chair ×8", categoryId: furniture!.id, status: "available", location: BLR_1, departmentId: facilities!.id, acquisitionCost: "72000.00", acquisitionDate: "2023-04-19", condition: "fair" },
    { assetTag: "AF-0099", name: "Whiteboard (Large)", categoryId: furniture!.id, status: "available", location: BLR_1, departmentId: engineering!.id, acquisitionCost: "7000.00", acquisitionDate: "2024-06-11", condition: "new" },
    { assetTag: "AF-0100", name: "Whiteboard (Large)", categoryId: furniture!.id, status: "available", location: PUNE, departmentId: qa!.id, acquisitionCost: "7000.00", acquisitionDate: "2024-06-11", condition: "new" },

    // ── Vehicles & heavy equipment ─────────────────────────────────────────
    { assetTag: "AF-0078", name: "Toyota Forklift", categoryId: vehicles!.id, status: "under_maintenance", location: WAREHOUSE, departmentId: fieldOps!.id, serialNumber: "TF-0078", acquisitionCost: "890000.00", acquisitionDate: "2021-02-11", condition: "fair", retirementDate: daysFromNow(45), customValues: { registration: "KA-51-FL-0078", insuranceExpiry: "2025-11-30" } },
    { assetTag: "AF-0701", name: "Bosch Drill Kit", categoryId: tools!.id, status: "allocated", location: WAREHOUSE, departmentId: facilities!.id, acquisitionCost: "16000.00", acquisitionDate: "2023-07-19", condition: "good", holder: "harsh", heldForDays: 18, dueInDays: 5 },
    { assetTag: "AF-0702", name: "Extension Ladder 12ft", categoryId: tools!.id, status: "available", location: WAREHOUSE, departmentId: facilities!.id, acquisitionCost: "9500.00", acquisitionDate: "2022-10-03", condition: "fair" },
    { assetTag: "AF-0703", name: "Safety Harness Set", categoryId: tools!.id, status: "allocated", location: FIELD, departmentId: fieldOpsEast!.id, acquisitionCost: "12000.00", acquisitionDate: "2024-01-29", condition: "good", holder: "nikhil", heldForDays: 25, dueInDays: 20 },
    { assetTag: "AF-0704", name: "Thermal Imaging Camera", categoryId: tools!.id, status: "available", location: FIELD, departmentId: fieldOps!.id, acquisitionCost: "145000.00", acquisitionDate: "2023-09-05", condition: "good" },

    // ── The tail of the lifecycle, so all 7 states appear in the UI ─────────
    { assetTag: "AF-0007", name: "Old Server Rack", categoryId: networking!.id, status: "retired", location: WAREHOUSE, departmentId: platform!.id, acquisitionCost: "260000.00", acquisitionDate: "2018-01-15", condition: "poor" },
    { assetTag: "AF-0006", name: "Legacy NAS Array", categoryId: networking!.id, status: "retired", location: WAREHOUSE, departmentId: platform!.id, acquisitionCost: "180000.00", acquisitionDate: "2017-05-22", condition: "poor" },
    { assetTag: "AF-0008", name: "CRT Monitor", categoryId: electronics!.id, status: "disposed", location: WAREHOUSE, departmentId: engineering!.id, acquisitionCost: "5000.00", acquisitionDate: "2015-03-01", condition: "poor" },
    // Confirmed missing by the CLOSED Q2 audit below — which is exactly how it
    // became 'lost'. The audit did not just report it; closing the cycle wrote it.
    { assetTag: "AF-0009", name: "Site Survey Tablet", categoryId: electronics!.id, status: "lost", location: FIELD, departmentId: fieldOps!.id, acquisitionCost: "40000.00", acquisitionDate: "2023-02-20", condition: "good" },
  ];

  /**
   * Assets are backdated to their acquisition date.
   *
   * Without this, every asset is "created" the instant the seed runs, and the idle
   * report — which measures the time since an asset was last used, falling back to
   * when it was registered — reports 0 days for everything. A brand-new database
   * would claim nothing has ever been idle, which is exactly the number that makes
   * the report look broken rather than empty.
   */
  const assets = await db
    .insert(s.assets)
    .values(
      assetRows.map(({ holder, holderDept, heldForDays, dueInDays, ...a }) => ({
        ...a,
        organizationId: orgId,
        createdBy: raj.id,
        createdAt: a.acquisitionDate ? new Date(a.acquisitionDate) : daysAgo(120),
      })),
    )
    .returning();

  const byTag = (tag: string) => assets.find((a) => a.assetTag === tag)!;

  // Fast-forward the sequence past every seeded tag, so the next asset a user
  // registers through the UI gets a fresh tag instead of colliding.
  await db.execute(sql`
    SELECT setval('asset_tag_seq',
      (SELECT COALESCE(MAX(substring(asset_tag from 4)::int), 0) + 1 FROM assets))
  `);

  // ── Allocations ──────────────────────────────────────────────────────────
  // DERIVED from the asset rows above, so 'allocated' and "has an open allocation"
  // cannot disagree. The open row (returned_at IS NULL) is what makes AF-0114
  // un-allocatable — the partial unique index only sees rows where it is null.
  const openAllocations = assetRows
    .filter((a) => a.status === "allocated")
    .map((a) => ({
      organizationId: orgId,
      assetId: byTag(a.assetTag).id,
      holderUserId: a.holder ? U(a.holder).id : null,
      holderDepartmentId: a.holderDept ?? null,
      allocatedBy: raj.id,
      allocatedAt: daysAgo(a.heldForDays ?? 30),
      expectedReturnDate: a.dueInDays === undefined ? null : daysFromNow(a.dueInDays),
    }));

  // CLOSED allocations — assets that came back. These are history, and they prove
  // the partial unique index permits many *returned* rows per asset while still
  // allowing only one open one. AF-0114's closed row is also what gives its
  // lifecycle timeline something to show before Priya.
  const closedAllocations = [
    { assetId: byTag("AF-0114").id, holderUserId: arjun.id, allocatedAt: daysAgo(88), returnedAt: daysAgo(35), returnConditionNotes: "Condition on return: good. Returned when Arjun moved to Platform — screen clean, no dents." },
    { assetId: byTag("AF-0201").id, holderUserId: U("ishita").id, allocatedAt: daysAgo(150), returnedAt: daysAgo(10), returnConditionNotes: "Condition on return: fair. Returned on exit — minor scuff on the armrest." },
    { assetId: byTag("AF-0020").id, holderUserId: U("ishita").id, allocatedAt: daysAgo(210), returnedAt: daysAgo(12), returnConditionNotes: "Condition on return: fair. Returned on exit — battery health 78%." },
    { assetId: byTag("AF-0062").id, holderUserId: rohan.id, allocatedAt: daysAgo(70), returnedAt: daysAgo(40), returnConditionNotes: "Condition on return: poor. Bulb dimming badly — raised for maintenance." },
    { assetId: byTag("AF-0090").id, holderUserId: U("dev").id, allocatedAt: daysAgo(120), returnedAt: daysAgo(30), returnConditionNotes: "Condition on return: good. Swapped for the 4K panel." },
    { assetId: byTag("AF-0702").id, holderUserId: vikram.id, allocatedAt: daysAgo(95), returnedAt: daysAgo(60), returnConditionNotes: "Condition on return: fair. Rung slightly bent — still serviceable." },
  ].map((a) => ({ ...a, organizationId: orgId, allocatedBy: raj.id }));

  await db.insert(s.allocations).values([...openAllocations, ...closedAllocations]);

  // ── Transfer requests ────────────────────────────────────────────────────
  // Three still waiting for approval (the dashboard's "Pending Transfers" KPI and
  // the right rail on the Allocation screen), plus history in both terminal states.
  await db.insert(s.transferRequests).values([
    { organizationId: orgId, assetId: byTag("AF-0012").id, fromUserId: arjun.id, toUserId: priya.id, reason: "Arjun has moved to the Platform team and no longer needs this machine.", status: "requested", requestedBy: priya.id },
    { organizationId: orgId, assetId: byTag("AF-0140").id, fromUserId: U("kabir").id, toUserId: vikram.id, reason: "Field kit reassignment for the east region site visits.", status: "requested", requestedBy: vikram.id },
    { organizationId: orgId, assetId: byTag("AF-0019").id, fromUserId: U("lakshmi").id, toUserId: U("karan").id, reason: "Karan is taking over the enterprise accounts and needs the bigger machine.", status: "requested", requestedBy: U("karan").id },

    { organizationId: orgId, assetId: byTag("AF-0033").id, fromUserId: null, toUserId: rohan.id, reason: "Moving the speakerphone to Facilities permanently.", status: "approved", requestedBy: rohan.id, approvedBy: raj.id, resolvedAt: daysAgo(6) },
    { organizationId: orgId, assetId: byTag("AF-0023").id, fromUserId: sana.id, toUserId: U("nikhil").id, reason: "Wanted for a two-week survey — rejected: Sana needs it for the Whitefield rollout until month end.", status: "rejected", requestedBy: U("nikhil").id, approvedBy: aditi.id, resolvedAt: daysAgo(9) },
  ]);

  // ── Bookings ─────────────────────────────────────────────────────────────
  // ★ Room B2, 09:00–10:00. A request for 09:30–10:30 must be rejected by the
  //   exclusion constraint. 10:00–11:00 must succeed — so that slot is LEFT FREE
  //   on purpose. Do not fill it.
  const B2 = byTag("AF-0500").id;
  const A1 = byTag("AF-0501").id;
  const C3 = byTag("AF-0502").id;
  const BOARD = byTag("AF-0503").id;
  const TRAINING = byTag("AF-0504").id;
  const VAN = byTag("AF-0343").id;
  const CAR = byTag("AF-0344").id;

  await db.insert(s.bookings).values([
    // ── Today, Room B2 ─────────────────────────────────────────────────────
    { organizationId: orgId, resourceId: B2, bookedBy: aditi.id, startsAt: todayAt(9), endsAt: todayAt(10), purpose: "Procurement team sync", status: "upcoming" },
    //                                                    ↑ 10:00–11:00 stays EMPTY ↑
    { organizationId: orgId, resourceId: B2, bookedBy: U("farhan").id, startsAt: todayAt(11, 30), endsAt: todayAt(12, 30), purpose: "QA release checklist", status: "upcoming" },
    { organizationId: orgId, resourceId: B2, bookedBy: priya.id, startsAt: todayAt(14), endsAt: todayAt(15), purpose: "Design review", status: "upcoming" },
    { organizationId: orgId, resourceId: B2, bookedBy: U("kabir").id, startsAt: todayAt(16, 30), endsAt: todayAt(17, 30), purpose: "Platform on-call handover", status: "upcoming" },

    // ── Today, the other rooms ─────────────────────────────────────────────
    { organizationId: orgId, resourceId: A1, bookedBy: rohan.id, startsAt: todayAt(11), endsAt: todayAt(12, 30), purpose: "Facilities standup", status: "upcoming" },
    { organizationId: orgId, resourceId: A1, bookedBy: U("zoya").id, startsAt: todayAt(15), endsAt: todayAt(16), purpose: "Invoice reconciliation", status: "upcoming" },
    { organizationId: orgId, resourceId: C3, bookedBy: U("neha").id, startsAt: todayAt(10), endsAt: todayAt(11, 30), purpose: "Brand workshop", status: "upcoming" },
    { organizationId: orgId, resourceId: C3, bookedBy: U("dev").id, startsAt: todayAt(13), endsAt: todayAt(14), purpose: "Design critique", status: "upcoming" },
    { organizationId: orgId, resourceId: BOARD, bookedBy: admin.id, startsAt: todayAt(15, 30), endsAt: todayAt(17), purpose: "Quarterly business review", status: "upcoming" },
    { organizationId: orgId, resourceId: TRAINING, bookedBy: U("tanvi").id, startsAt: todayAt(9, 30), endsAt: todayAt(12, 30), purpose: "New-joiner QA onboarding", status: "upcoming" },

    // ── Today, vehicles — all-day, so the grid shows a long block ───────────
    { organizationId: orgId, resourceId: VAN, bookedBy: sana.id, startsAt: todayAt(8), endsAt: todayAt(17), purpose: "East region site visits", status: "ongoing" },
    { organizationId: orgId, resourceId: CAR, bookedBy: U("karan").id, startsAt: todayAt(10), endsAt: todayAt(13), purpose: "Client visit — Koramangala", status: "upcoming" },

    // ── Tomorrow, so "next day" on the grid is not empty ────────────────────
    //
    // Room B2's 09:00–11:00 window TOMORROW is deliberately empty. docs/DEMO.md
    // hands a judge a curl script that books tomorrow 09:00–10:00, then expects
    // 09:30–10:30 to be refused and 10:00–11:00 to be accepted. Seeding anything
    // into that window would make the documented script fail on a fresh clone —
    // and it would look like the constraint was wrong, rather than the seed.
    { organizationId: orgId, resourceId: B2, bookedBy: raj.id, startsAt: dayAt(1, 15), endsAt: dayAt(1, 16), purpose: "Asset audit prep", status: "upcoming" },
    { organizationId: orgId, resourceId: BOARD, bookedBy: U("divya").id, startsAt: dayAt(1, 14), endsAt: dayAt(1, 16), purpose: "Budget close", status: "upcoming" },
  ]);

  /**
   * Three weeks of past bookings, so the booking heatmap has a real shape.
   *
   * One booking per resource per day means two rows can never share a resource AND
   * a time range — so the exclusion constraint is satisfied by construction rather
   * than by hoping. The hour is derived from the day so the heatmap gets a spread
   * across the working day instead of a single vertical stripe.
   */
  const pastRooms = [B2, A1, C3, BOARD, TRAINING];
  const pastPurposes = ["Team sync", "Sprint planning", "1:1", "Client call", "Retro", "Interview", "Vendor demo", "All-hands"];
  const pastBookers = [aditi, rohan, priya, arjun, U("neha"), U("tanvi"), U("kabir"), U("divya")];

  const pastBookings = [];
  for (let d = 1; d <= 21; d++) {
    for (const [i, resourceId] of pastRooms.entries()) {
      // Skip weekends — an office booking heatmap that is busy on Sunday is a lie.
      const weekday = new Date(Date.now() - d * 86_400_000).getDay();
      if (weekday === 0 || weekday === 6) continue;

      // Not every room is used every day.
      if ((d + i) % 3 === 0) continue;

      const hour = 9 + ((d * 2 + i * 3) % 8); // 09:00–16:00
      pastBookings.push({
        organizationId: orgId,
        resourceId,
        bookedBy: pastBookers[(d + i) % pastBookers.length]!.id,
        startsAt: dayAt(-d, hour),
        endsAt: dayAt(-d, hour + 1),
        purpose: pastPurposes[(d + i) % pastPurposes.length]!,
        status: "completed" as const,
      });
    }
  }
  await db.insert(s.bookings).values(pastBookings);

  // ── Maintenance ──────────────────────────────────────────────────────────
  // The live board — one card per Kanban column.
  //
  // Asset status and maintenance status MUST agree. An asset is only
  // 'under_maintenance' once its request has been approved; a *pending* request
  // leaves the asset available. That is the entire point of the approval gate, and
  // seeding it inconsistently would contradict the rule the app enforces.
  //   AF-0062 pending            → asset stays 'available'
  //   AF-0088 approved           → asset is 'under_maintenance'
  //   AF-0078 technician_assigned→ asset is 'under_maintenance'
  //   AF-0055 in_progress        → asset is 'under_maintenance'
  //   AF-0410 resolved           → asset is back to 'available'
  await db.insert(s.maintenanceRequests).values([
    { organizationId: orgId, assetId: byTag("AF-0062").id, reportedBy: rohan.id, issueDescription: "Projector bulb will not turn on. Tried two sockets and a different cable.", priority: "high", status: "pending" },
    { organizationId: orgId, assetId: byTag("AF-0088").id, reportedBy: priya.id, issueDescription: "Monitor flickers intermittently on the HDMI input. Fine over USB-C.", priority: "medium", status: "approved", approvedBy: raj.id, approvedAt: minutesAgo(90) },
    { organizationId: orgId, assetId: byTag("AF-0078").id, reportedBy: sana.id, issueDescription: "Forklift hydraulics leaking — a puddle under the mast every morning. Taken out of service.", priority: "critical", status: "technician_assigned", approvedBy: raj.id, approvedAt: daysAgo(2), technicianId: vikram.id },
    { organizationId: orgId, assetId: byTag("AF-0055").id, reportedBy: vikram.id, issueDescription: "Printer jams on every duplex job. Feed roller parts ordered.", priority: "low", status: "in_progress", approvedBy: raj.id, approvedAt: daysAgo(4), technicianId: U("harsh").id },
    { organizationId: orgId, assetId: byTag("AF-0410").id, reportedBy: rohan.id, issueDescription: "Two chairs will not hold height.", priority: "low", status: "resolved", approvedBy: raj.id, approvedAt: daysAgo(5), technicianId: vikram.id, resolvedAt: minutesAgo(120), resolutionNotes: "Gas lifts replaced under warranty on both." },

    // Rejected — a terminal state that lives off the board, so the Rejected section
    // below the Kanban is not empty.
    { organizationId: orgId, assetId: byTag("AF-0020").id, reportedBy: U("kabir").id, issueDescription: "Battery drains in 2 hours, would like it replaced.", priority: "medium", status: "rejected", approvedBy: raj.id, approvedAt: daysAgo(7), rejectionReason: "This machine retires in three weeks — it is being replaced, not repaired." },
  ]);

  // A year of resolved history, so the maintenance-frequency line chart has an
  // actual trend to draw. Without this every request sits in the current month and
  // the chart is a flat line with one spike at the end.
  const historicalIssues: Array<[string, number, string]> = [
    ["AF-0062", 22, "Lamp replaced after 2000 hours."],
    ["AF-0055", 28, "Toner sensor recalibrated."],
    ["AF-0078", 35, "Hydraulic seal replaced."],
    ["AF-0012", 41, "Battery swelled — replaced under warranty."],
    ["AF-0343", 48, "Tyre puncture repaired."],
    ["AF-0088", 55, "Dead pixel cluster; panel swapped."],
    ["AF-0062", 63, "Fan cleaned, overheating resolved."],
    ["AF-0604", 70, "UPS battery bank replaced."],
    ["AF-0078", 78, "Annual hydraulics service."],
    ["AF-0344", 84, "Brake pads and front rotors."],
    ["AF-0410", 92, "Castors replaced on four chairs."],
    ["AF-0055", 101, "Paper feed roller replaced."],
    ["AF-0023", 110, "Ruggedised case reseal."],
    ["AF-0078", 125, "Brake pads replaced."],
    ["AF-0301", 133, "Sensor cleaned, shutter recalibrated."],
    ["AF-0343", 140, "Clutch plate replaced."],
    ["AF-0016", 152, "Keyboard replaced — sticky keys."],
    ["AF-0601", 168, "Firmware upgrade and fan swap."],
    ["AF-0021", 181, "Screen protector reapplied."],
    ["AF-0055", 195, "Fuser unit replaced."],
    ["AF-0201", 210, "Armrest bolt tightened."],
    ["AF-0078", 240, "Forks re-welded after a drop."],
    ["AF-0088", 268, "Stand replaced."],
    ["AF-0343", 300, "Full service, 60,000 km."],
    ["AF-0702", 330, "Rung straightened, safety-checked."],
  ];

  await db.insert(s.maintenanceRequests).values(
    historicalIssues.map(([tag, days, notes]) => ({
      organizationId: orgId,
      assetId: byTag(tag).id,
      reportedBy: rohan.id,
      issueDescription: notes,
      priority: "medium" as const,
      status: "resolved" as const,
      approvedBy: raj.id,
      approvedAt: daysAgo(days),
      technicianId: vikram.id,
      resolvedAt: daysAgo(days - 2),
      resolutionNotes: notes,
      createdAt: daysAgo(days),
    })),
  );

  // ── Audit cycles ─────────────────────────────────────────────────────────
  // One OPEN cycle to work in, and one CLOSED cycle as evidence. The closed one is
  // where AF-0009 became 'lost': confirming an asset missing and closing the cycle
  // is what wrote that status. The audit does not just report the truth — it sets it.
  const [q3, q2] = await db
    .insert(s.auditCycles)
    .values([
      { organizationId: orgId, name: "Q3 Audit — Engineering", scopeDepartmentId: engineering!.id, scopeLocation: BLR_2, startDate: daysFromNow(-5), endDate: daysFromNow(10), status: "open", createdBy: admin.id },
      { organizationId: orgId, name: "Q2 Audit — Field Ops", scopeDepartmentId: fieldOps!.id, startDate: daysFromNow(-120), endDate: daysFromNow(-100), status: "closed", createdBy: admin.id, closedAt: daysAgo(100) },
    ])
    .returning();

  await db.insert(s.auditCycleAuditors).values([
    // "One or more auditors" — a genuine many-to-many, not a single auditor column.
    { cycleId: q3!.id, userId: aditi.id },
    { cycleId: q3!.id, userId: sana.id },
    { cycleId: q3!.id, userId: raj.id },
    { cycleId: q2!.id, userId: sana.id },
    { cycleId: q2!.id, userId: U("imran").id },
  ]);

  await db.insert(s.auditItems).values([
    // The open cycle: some checked, some not — so the progress bar is mid-way and
    // the discrepancy banner has something to report.
    { cycleId: q3!.id, assetId: byTag("AF-0114").id, expectedLocation: "Desk E12", status: "verified", checkedBy: aditi.id, checkedAt: daysAgo(2) },
    { cycleId: q3!.id, assetId: byTag("AF-0089").id, expectedLocation: "Desk E12", status: "verified", checkedBy: aditi.id, checkedAt: daysAgo(2) },
    { cycleId: q3!.id, assetId: byTag("AF-0203").id, expectedLocation: "Desk E09", status: "verified", checkedBy: raj.id, checkedAt: daysAgo(1) },
    { cycleId: q3!.id, assetId: byTag("AF-0088").id, expectedLocation: "Desk E15", status: "damaged", notes: "Cracked panel, bottom-left corner. Already with maintenance.", checkedBy: aditi.id, checkedAt: daysAgo(1) },
    { cycleId: q3!.id, assetId: byTag("AF-0020").id, expectedLocation: "Desk E14", status: "missing", notes: "Not at the desk. Last holder has left the company.", checkedBy: sana.id, checkedAt: daysAgo(1) },
    { cycleId: q3!.id, assetId: byTag("AF-0012").id, expectedLocation: "Desk E11", status: "pending" },
    { cycleId: q3!.id, assetId: byTag("AF-0099").id, expectedLocation: "Wall, Bay 2", status: "pending" },
    { cycleId: q3!.id, assetId: byTag("AF-0021").id, expectedLocation: "Desk E17", status: "pending" },

    // The closed cycle: fully checked. AF-0009 was confirmed missing → 'lost'.
    { cycleId: q2!.id, assetId: byTag("AF-0009").id, expectedLocation: "Field kit, van 2", status: "missing", notes: "Not recovered after the Whitefield rollout. Written off.", checkedBy: sana.id, checkedAt: daysAgo(102) },
    { cycleId: q2!.id, assetId: byTag("AF-0023").id, expectedLocation: "Field kit, van 1", status: "verified", checkedBy: sana.id, checkedAt: daysAgo(103) },
    { cycleId: q2!.id, assetId: byTag("AF-0343").id, expectedLocation: WAREHOUSE, status: "verified", checkedBy: U("imran").id, checkedAt: daysAgo(103) },
    { cycleId: q2!.id, assetId: byTag("AF-0704").id, expectedLocation: "Field kit, van 1", status: "verified", checkedBy: U("imran").id, checkedAt: daysAgo(104) },
  ]);

  // ── Notifications ────────────────────────────────────────────────────────
  // At least one of every type in the spec, addressed to the person who would
  // actually receive it — so signing in as any of the four demo accounts shows a
  // bell with something real in it.
  await db.insert(s.notifications).values([
    { organizationId: orgId, userId: priya.id, type: "asset_assigned", title: "MacBook Pro 14 (AF-0114) assigned to you", body: `Return by ${daysFromNow(30)}.`, link: "/assets", createdAt: minutesAgo(3) },
    { organizationId: orgId, userId: priya.id, type: "booking_reminder", title: "Room B2 starts soon", body: "Design review at 14:00.", link: "/booking", createdAt: minutesAgo(9) },
    { organizationId: orgId, userId: raj.id, type: "maintenance_approved", title: "Maintenance approved: AF-0088", body: "Dell UltraSharp 27\" — moved to Under Maintenance.", link: "/maintenance", createdAt: minutesAgo(90) },
    { organizationId: orgId, userId: U("kabir").id, type: "maintenance_rejected", title: "Maintenance rejected: AF-0020", body: "This machine retires in three weeks — it is being replaced, not repaired.", link: "/maintenance", createdAt: daysAgo(7) },
    { organizationId: orgId, userId: aditi.id, type: "booking_confirmed", title: "Booking confirmed: Room B2", body: "Today 09:00–10:00 — procurement team sync.", link: "/booking", createdAt: minutesAgo(140) },
    { organizationId: orgId, userId: U("neha").id, type: "booking_confirmed", title: "Booking confirmed: Room C3", body: "Today 10:00–11:30 — brand workshop.", link: "/booking", createdAt: minutesAgo(200) },
    { organizationId: orgId, userId: U("dev").id, type: "booking_cancelled", title: "Booking cancelled: Room A1", body: "Yesterday 15:00 — cancelled by the organiser.", link: "/booking", createdAt: daysAgo(1) },
    { organizationId: orgId, userId: rohan.id, type: "transfer_approved", title: "Transfer approved: AF-0033 → Facilities", body: "Conference speakerphone re-allocated.", link: "/allocation", createdAt: daysAgo(6) },
    { organizationId: orgId, userId: raj.id, type: "transfer_approved", title: "3 transfer requests are waiting", body: "AF-0012, AF-0140 and AF-0019 need a decision.", link: "/allocation", createdAt: minutesAgo(45) },
    { organizationId: orgId, userId: admin.id, type: "audit_discrepancy", title: "Audit discrepancy: AF-0088 damaged", body: "Q3 Audit — Engineering: cracked panel, bottom-left.", link: "/audit", createdAt: daysAgo(1) },
    { organizationId: orgId, userId: admin.id, type: "audit_discrepancy", title: "Audit discrepancy: AF-0020 missing", body: "Q3 Audit — Engineering: not at the expected desk.", link: "/audit", createdAt: daysAgo(1) },
    { organizationId: orgId, userId: aditi.id, type: "asset_assigned", title: "Standing desk (AF-0203) assigned to you", body: "Bengaluru HQ · Floor 2.", link: "/assets", createdAt: daysAgo(70) },

    // NOTE: no overdue_return notification is seeded, even though AF-0021 and
    // AF-0022 ARE overdue. That is on purpose — the overdue-returns cron job
    // generates it. Seeding one would both duplicate the job's output and spoil the
    // demo: the point is to trigger the job (Notifications → Scheduled jobs) and
    // watch the alert land in the bell live, over the WebSocket.
  ]);

  // ── Activity log ─────────────────────────────────────────────────────────
  // This is the table the asset lifecycle timeline renders, and the org-wide
  // activity feed, and the audit trail. One table, three features.
  //
  // AF-0114 gets a full story — registered, allocated to Arjun, returned,
  // transferred, allocated to Priya — because that asset is the one a judge will
  // open, and a timeline with one dot on it proves nothing.
  const laptop = byTag("AF-0114").id;
  await db.insert(s.activityLogs).values([
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: laptop, action: "registered", summary: "MacBook Pro 14 (AF-0114) registered — Electronics, Bengaluru HQ · Floor 2", createdAt: daysAgo(120) },
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: laptop, action: "allocated", summary: "AF-0114 allocated to Arjun Nair — Engineering", metadata: { to: "Arjun Nair" }, createdAt: daysAgo(88) },
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: laptop, action: "maintenance_approved", summary: "AF-0114 sent for maintenance — keyboard replacement", createdAt: daysAgo(52) },
    { organizationId: orgId, actorId: vikram.id, entityType: "maintenance", entityId: laptop, action: "maintenance_resolved", summary: "AF-0114 maintenance resolved — keyboard replaced under warranty", createdAt: daysAgo(47) },
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: laptop, action: "returned", summary: "AF-0114 returned by Arjun Nair — condition: good", createdAt: daysAgo(35) },
    { organizationId: orgId, actorId: aditi.id, entityType: "transfer", entityId: laptop, action: "transfer_approved", summary: "AF-0114 transfer approved — Arjun Nair → Priya Sharma", createdAt: daysAgo(29) },
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: laptop, action: "allocated", summary: "AF-0114 allocated to Priya Sharma — Engineering", metadata: { to: "Priya Sharma" }, createdAt: daysAgo(28) },

    // The rest of the org, so the dashboard's recent-activity feed is alive.
    { organizationId: orgId, actorId: admin.id, entityType: "audit", entityId: q3!.id, action: "audit_opened", summary: "Q3 Audit — Engineering opened with 3 auditors", createdAt: daysAgo(5) },
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: byTag("AF-0024").id, action: "registered", summary: "Mac Mini M2 (AF-0024) registered — Electronics", createdAt: daysAgo(15) },
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: byTag("AF-0024").id, action: "allocated", summary: "AF-0024 allocated to Kabir Shah — Platform", createdAt: daysAgo(15) },
    { organizationId: orgId, actorId: raj.id, entityType: "asset", entityId: byTag("AF-0201").id, action: "returned", summary: "AF-0201 returned by Ishita Roy — condition: fair", createdAt: daysAgo(10) },
    { organizationId: orgId, actorId: raj.id, entityType: "maintenance", entityId: byTag("AF-0020").id, action: "maintenance_rejected", summary: "AF-0020 maintenance rejected — retiring in three weeks", createdAt: daysAgo(7) },
    { organizationId: orgId, actorId: raj.id, entityType: "transfer", entityId: byTag("AF-0033").id, action: "transfer_approved", summary: "AF-0033 transfer approved — re-allocated to Facilities", createdAt: daysAgo(6) },
    { organizationId: orgId, actorId: aditi.id, entityType: "audit", entityId: q3!.id, action: "audit_discrepancy", summary: "AF-0020 marked missing during Q3 Audit — Engineering", createdAt: daysAgo(1) },
    { organizationId: orgId, actorId: aditi.id, entityType: "audit", entityId: q3!.id, action: "audit_discrepancy", summary: "AF-0088 marked damaged during Q3 Audit — Engineering", createdAt: daysAgo(1) },
    { organizationId: orgId, actorId: raj.id, entityType: "maintenance", entityId: byTag("AF-0088").id, action: "maintenance_approved", summary: "AF-0088 approved for maintenance — moved to Under Maintenance", createdAt: minutesAgo(90) },
    { organizationId: orgId, actorId: aditi.id, entityType: "booking", entityId: B2, action: "booking_confirmed", summary: "Room B2 booked 09:00–10:00 — procurement team sync", createdAt: minutesAgo(140) },
    { organizationId: orgId, actorId: vikram.id, entityType: "maintenance", entityId: byTag("AF-0410").id, action: "maintenance_resolved", summary: "AF-0410 maintenance resolved — gas lifts replaced", createdAt: minutesAgo(120) },
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────
  const bookingCount = 14 + pastBookings.length;
  const overdue = assetRows.filter((a) => (a.dueInDays ?? 0) < 0).length;

  console.log("  Organization   Acme Corp");
  console.log("  Departments    10  (Platform, QA → Engineering · Field Ops (East) → Field Ops)");
  console.log(`  Users          ${users.length} across all 4 roles`);
  console.log(`  Assets         ${assets.length} across all 7 lifecycle states, 6 categories`);
  console.log(`  Allocations    ${openAllocations.length} open (${overdue} overdue), ${closedAllocations.length} returned`);
  console.log("  Transfers      3 pending, 2 decided");
  console.log(`  Bookings       ${bookingCount}  (today + 3 weeks of history for the heatmap)`);
  console.log("  Maintenance    6 on the board, 25 resolved over the past year");
  console.log("  Audit          1 open cycle (3 auditors, 2 discrepancies), 1 closed\n");

  console.log("Log in with any of these — password is 'password123':");
  console.log("  admin@acme.test   Admin");
  console.log("  raj@acme.test     Asset Manager");
  console.log("  aditi@acme.test   Department Head");
  console.log("  priya@acme.test   Employee (holds AF-0114)\n");

  console.log("The two scenarios from the spec are now live:");
  console.log("  1. AF-0114 'MacBook Pro 14' is held by Priya Sharma");
  console.log("     → allocating it to anyone else is rejected by one_active_allocation");
  console.log("  2. Room B2 is booked today 09:00–10:00 (10:00–11:00 left free on purpose)");
  console.log("     → 09:30–10:30 is rejected by no_overlap; 10:00–11:00 is accepted\n");
}

await seed();
await closeDatabase();
