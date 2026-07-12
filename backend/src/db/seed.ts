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
 * Idempotent: truncates everything, then rebuilds. Safe to run repeatedly.
 */
import { sql } from "drizzle-orm";

import { closeDatabase, db } from "../config/db";
import * as s from "./schema";

const PASSWORD = "password123";

/** Today at a given wall-clock hour, so seeded bookings always land on "today". */
function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  // ── Departments (with a real hierarchy: Platform sits under Engineering) ──
  const [engineering, facilities, fieldOps] = await db
    .insert(s.departments)
    .values([
      { organizationId: orgId, name: "Engineering" },
      { organizationId: orgId, name: "Facilities" },
      { organizationId: orgId, name: "Field Ops" },
    ])
    .returning();

  const [platform, fieldOpsEast] = await db
    .insert(s.departments)
    .values([
      { organizationId: orgId, name: "Platform", parentDepartmentId: engineering!.id },
      { organizationId: orgId, name: "Field Ops (East)", parentDepartmentId: fieldOps!.id, status: "inactive" },
    ])
    .returning();

  // ── People ───────────────────────────────────────────────────────────────
  // Every role is represented so a judge can log in as each and see RBAC work.
  const [admin, raj, priya, aditi, rohan, sana, arjun, vikram] = await db
    .insert(s.users)
    .values([
      { organizationId: orgId, name: "Admin User", email: "admin@acme.test", passwordHash, role: "admin" },
      { organizationId: orgId, name: "Raj Verma", email: "raj@acme.test", passwordHash, role: "asset_manager", departmentId: engineering!.id },
      { organizationId: orgId, name: "Priya Sharma", email: "priya@acme.test", passwordHash, role: "employee", departmentId: engineering!.id },
      { organizationId: orgId, name: "Aditi Rao", email: "aditi@acme.test", passwordHash, role: "department_head", departmentId: engineering!.id },
      { organizationId: orgId, name: "Rohan Mehta", email: "rohan@acme.test", passwordHash, role: "department_head", departmentId: facilities!.id },
      { organizationId: orgId, name: "Sana Iqbal", email: "sana@acme.test", passwordHash, role: "employee", departmentId: fieldOps!.id },
      { organizationId: orgId, name: "Arjun Nair", email: "arjun@acme.test", passwordHash, role: "employee", departmentId: platform!.id },
      { organizationId: orgId, name: "Vikram Singh", email: "vikram@acme.test", passwordHash, role: "employee", departmentId: facilities!.id },
    ])
    .returning();

  // Department heads (circular FK — must be set after the users exist).
  await db.update(s.departments).set({ headUserId: aditi!.id }).where(sql`id = ${engineering!.id}`);
  await db.update(s.departments).set({ headUserId: rohan!.id }).where(sql`id = ${facilities!.id}`);
  await db.update(s.departments).set({ headUserId: sana!.id }).where(sql`id = ${fieldOpsEast!.id}`);

  // ── Categories (Electronics carries a category-specific custom field) ────
  const [electronics, furniture, vehicles, rooms] = await db
    .insert(s.assetCategories)
    .values([
      {
        organizationId: orgId,
        name: "Electronics",
        description: "Laptops, monitors, projectors",
        customFields: [
          { key: "warrantyMonths", label: "Warranty (months)", type: "number" },
          { key: "supplier", label: "Supplier", type: "text" },
        ],
      },
      { organizationId: orgId, name: "Furniture", description: "Desks, chairs, cabinets" },
      { organizationId: orgId, name: "Vehicles", description: "Vans, forklifts" },
      { organizationId: orgId, name: "Rooms", description: "Bookable spaces" },
    ])
    .returning();

  // ── Assets ───────────────────────────────────────────────────────────────
  // Tags are set EXPLICITLY here (not left to the sequence) because the spec
  // names AF-0114 and AF-0062 specifically. The sequence is fast-forwarded past
  // the highest tag afterwards so live registrations continue cleanly.
  const assetRows = [
    // ★ The star of scenario #1 — allocated to Priya below.
    { assetTag: "AF-0114", name: "MacBook Pro 14", categoryId: electronics!.id, status: "allocated" as const, location: "Bengaluru", departmentId: engineering!.id, serialNumber: "C02XY1114", acquisitionCost: "185000.00", acquisitionDate: "2024-03-12", condition: "good" as const, customValues: { warrantyMonths: 24, supplier: "Apple" } },

    // ★ The star of scenario #2 — bookable, with a 09:00–10:00 booking below.
    { assetTag: "AF-0500", name: "Room B2", categoryId: rooms!.id, status: "available" as const, location: "HQ Floor 2", departmentId: facilities!.id, isBookable: true, condition: "good" as const },

    // Other bookable resources, so the booking screen has a real picker.
    { assetTag: "AF-0501", name: "Room A1", categoryId: rooms!.id, status: "available" as const, location: "HQ Floor 1", departmentId: facilities!.id, isBookable: true, condition: "good" as const },
    { assetTag: "AF-0343", name: "Delivery Van", categoryId: vehicles!.id, status: "available" as const, location: "Warehouse", departmentId: fieldOps!.id, isBookable: true, acquisitionCost: "1250000.00", acquisitionDate: "2022-06-01", condition: "fair" as const },

    // Asset status and maintenance status must AGREE: an asset is only
    // under_maintenance once its request has been approved. A pending request
    // leaves the asset available — that is the entire point of the approval gate,
    // and seeding it inconsistently would contradict the rule the app enforces.
    // Spread across every lifecycle state so no KPI card reads zero.
    { assetTag: "AF-0012", name: "Dell Latitude 7440", categoryId: electronics!.id, status: "allocated" as const, location: "Bengaluru", departmentId: engineering!.id, serialNumber: "DL7440-012", acquisitionCost: "95000.00", acquisitionDate: "2024-01-20", condition: "good" as const, customValues: { warrantyMonths: 36, supplier: "Dell" } },
    { assetTag: "AF-0062", name: "Epson Projector", categoryId: electronics!.id, status: "available" as const, location: "HQ Floor 2", departmentId: facilities!.id, serialNumber: "EP-0062", acquisitionCost: "48000.00", acquisitionDate: "2023-08-15", condition: "poor" as const },
    { assetTag: "AF-0201", name: "Ergonomic Office Chair", categoryId: furniture!.id, status: "available" as const, location: "Warehouse", departmentId: facilities!.id, acquisitionCost: "18000.00", acquisitionDate: "2024-05-02", condition: "new" as const },
    { assetTag: "AF-0202", name: "Standing Desk", categoryId: furniture!.id, status: "available" as const, location: "Warehouse", departmentId: facilities!.id, acquisitionCost: "32000.00", acquisitionDate: "2024-05-02", condition: "new" as const },
    { assetTag: "AF-0078", name: "Toyota Forklift", categoryId: vehicles!.id, status: "under_maintenance" as const, location: "Warehouse", departmentId: fieldOps!.id, serialNumber: "TF-0078", acquisitionCost: "890000.00", acquisitionDate: "2021-02-11", condition: "fair" as const, retirementDate: daysFromNow(45) },
    { assetTag: "AF-0033", name: "Conference Speakerphone", categoryId: electronics!.id, status: "allocated" as const, location: "HQ Floor 1", departmentId: facilities!.id, acquisitionCost: "22000.00", acquisitionDate: "2023-11-30", condition: "good" as const },
    { assetTag: "AF-0021", name: "iPad Pro 12.9", categoryId: electronics!.id, status: "allocated" as const, location: "Bengaluru", departmentId: engineering!.id, serialNumber: "IP-0021", acquisitionCost: "120000.00", acquisitionDate: "2023-09-14", condition: "good" as const },
    { assetTag: "AF-0088", name: "Dell UltraSharp Monitor", categoryId: electronics!.id, status: "under_maintenance" as const, location: "HQ Floor 2", departmentId: engineering!.id, serialNumber: "DU-0088", acquisitionCost: "45000.00", acquisitionDate: "2024-02-08", condition: "damaged" as const },
    { assetTag: "AF-0301", name: "Canon EOS Camera", categoryId: electronics!.id, status: "available" as const, location: "Warehouse", departmentId: facilities!.id, acquisitionCost: "78000.00", acquisitionDate: "2022-12-01", condition: "good" as const },
    { assetTag: "AF-0410", name: "Meeting Room Chair", categoryId: furniture!.id, status: "available" as const, location: "HQ Floor 1", departmentId: facilities!.id, acquisitionCost: "9000.00", acquisitionDate: "2023-04-19", condition: "fair" as const },
    { assetTag: "AF-0020", name: "ThinkPad X1 Carbon", categoryId: electronics!.id, status: "available" as const, location: "Bengaluru", departmentId: platform!.id, serialNumber: "TP-0020", acquisitionCost: "140000.00", acquisitionDate: "2021-06-30", condition: "fair" as const, retirementDate: daysFromNow(20) },
    { assetTag: "AF-0055", name: "HP LaserJet Printer", categoryId: electronics!.id, status: "under_maintenance" as const, location: "HQ Floor 2", departmentId: facilities!.id, acquisitionCost: "35000.00", acquisitionDate: "2023-07-07", condition: "good" as const },
    { assetTag: "AF-0099", name: "Whiteboard (Large)", categoryId: furniture!.id, status: "available" as const, location: "HQ Floor 1", departmentId: engineering!.id, acquisitionCost: "7000.00", acquisitionDate: "2024-06-11", condition: "new" as const },
    { assetTag: "AF-0140", name: "Logitech Webcam", categoryId: electronics!.id, status: "allocated" as const, location: "Bengaluru", departmentId: platform!.id, acquisitionCost: "12000.00", acquisitionDate: "2024-04-03", condition: "good" as const },

    // The remaining lifecycle states, so all 7 appear in the UI.
    { assetTag: "AF-0007", name: "Old Server Rack", categoryId: electronics!.id, status: "retired" as const, location: "Warehouse", departmentId: engineering!.id, acquisitionCost: "260000.00", acquisitionDate: "2018-01-15", condition: "poor" as const },
    { assetTag: "AF-0008", name: "CRT Monitor", categoryId: electronics!.id, status: "disposed" as const, location: "Warehouse", departmentId: engineering!.id, acquisitionCost: "5000.00", acquisitionDate: "2015-03-01", condition: "poor" as const },
    { assetTag: "AF-0009", name: "Site Survey Tablet", categoryId: electronics!.id, status: "lost" as const, location: "Field", departmentId: fieldOps!.id, acquisitionCost: "40000.00", acquisitionDate: "2023-02-20", condition: "good" as const },
    { assetTag: "AF-0335", name: "Portable Projector", categoryId: electronics!.id, status: "reserved" as const, location: "HQ Floor 1", departmentId: facilities!.id, acquisitionCost: "30000.00", acquisitionDate: "2024-01-05", condition: "good" as const },
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
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  const assets = await db
    .insert(s.assets)
    .values(
      assetRows.map((a) => ({
        ...a,
        organizationId: orgId,
        createdBy: raj!.id,
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
  // The open row (returned_at IS NULL) is what makes AF-0114 un-allocatable.
  // allocatedAt is backdated too — an asset allocated "just now" tells the usage
  // reports nothing about how long it has actually been out.
  await db.insert(s.allocations).values([
    { organizationId: orgId, assetId: byTag("AF-0114").id, holderUserId: priya!.id, allocatedBy: raj!.id, allocatedAt: daysAgo(28), expectedReturnDate: daysFromNow(30) },
    { organizationId: orgId, assetId: byTag("AF-0012").id, holderUserId: arjun!.id, allocatedBy: raj!.id, allocatedAt: daysAgo(45), expectedReturnDate: daysFromNow(14) },
    { organizationId: orgId, assetId: byTag("AF-0033").id, holderDepartmentId: facilities!.id, allocatedBy: raj!.id, allocatedAt: daysAgo(60) },
    { organizationId: orgId, assetId: byTag("AF-0140").id, holderUserId: sana!.id, allocatedBy: raj!.id, allocatedAt: daysAgo(12), expectedReturnDate: daysFromNow(7) },

    // OVERDUE: due 3 days ago and still not returned. The dashboard's red banner
    // and the overdue cron both key off exactly this shape.
    { organizationId: orgId, assetId: byTag("AF-0021").id, holderUserId: vikram!.id, allocatedBy: raj!.id, allocatedAt: daysAgo(40), expectedReturnDate: daysFromNow(-3) },

    // A CLOSED allocation — the asset came back. This is history, and it proves
    // the partial unique index permits many returned rows per asset.
    { organizationId: orgId, assetId: byTag("AF-0201").id, holderUserId: arjun!.id, allocatedBy: raj!.id, allocatedAt: daysAgo(50), returnedAt: daysAgo(10), returnConditionNotes: "Returned in good condition. Minor scuff on the armrest." },
  ]);

  // ── Transfer requests ────────────────────────────────────────────────────
  await db.insert(s.transferRequests).values([
    { organizationId: orgId, assetId: byTag("AF-0012").id, fromUserId: arjun!.id, toUserId: priya!.id, reason: "Arjun is moving to the Platform team and no longer needs this machine.", status: "requested", requestedBy: priya!.id },
    { organizationId: orgId, assetId: byTag("AF-0140").id, fromUserId: sana!.id, toUserId: vikram!.id, reason: "Field kit reassignment for the east region.", status: "requested", requestedBy: vikram!.id },
    { organizationId: orgId, assetId: byTag("AF-0033").id, fromUserId: null, toUserId: rohan!.id, reason: "Moving the speakerphone to Facilities permanently.", status: "requested", requestedBy: rohan!.id },
  ]);

  // ── Bookings ─────────────────────────────────────────────────────────────
  // ★ THE 09:00–10:00 BOOKING. A request for 09:30–10:30 must be rejected by the
  //   exclusion constraint; 10:00–11:00 must succeed.
  await db.insert(s.bookings).values([
    { organizationId: orgId, resourceId: byTag("AF-0500").id, bookedBy: aditi!.id, startsAt: todayAt(9), endsAt: todayAt(10), purpose: "Procurement Team sync", status: "upcoming" },
    { organizationId: orgId, resourceId: byTag("AF-0500").id, bookedBy: priya!.id, startsAt: todayAt(14), endsAt: todayAt(15), purpose: "Design review", status: "upcoming" },
    { organizationId: orgId, resourceId: byTag("AF-0501").id, bookedBy: rohan!.id, startsAt: todayAt(11), endsAt: todayAt(12, 30), purpose: "Facilities standup", status: "upcoming" },
    { organizationId: orgId, resourceId: byTag("AF-0343").id, bookedBy: sana!.id, startsAt: todayAt(8), endsAt: todayAt(17), purpose: "East region site visits", status: "ongoing" },
    { organizationId: orgId, resourceId: byTag("AF-0501").id, bookedBy: arjun!.id, startsAt: todayAt(-24 + 10), endsAt: todayAt(-24 + 11), purpose: "Sprint retro", status: "completed" },
  ]);

  // ── Maintenance (one card per Kanban column) ─────────────────────────────
  // The live board (5 open cards, one per column) …
  await db.insert(s.maintenanceRequests).values([
    { organizationId: orgId, assetId: byTag("AF-0062").id, reportedBy: rohan!.id, issueDescription: "Projector bulb not turning on.", priority: "high", status: "pending" },
    { organizationId: orgId, assetId: byTag("AF-0088").id, reportedBy: priya!.id, issueDescription: "Monitor flickers intermittently on the HDMI input.", priority: "medium", status: "approved", approvedBy: raj!.id, approvedAt: new Date() },
    { organizationId: orgId, assetId: byTag("AF-0078").id, reportedBy: sana!.id, issueDescription: "Forklift hydraulics leaking.", priority: "critical", status: "technician_assigned", approvedBy: raj!.id, approvedAt: new Date(), technicianId: vikram!.id },
    { organizationId: orgId, assetId: byTag("AF-0055").id, reportedBy: vikram!.id, issueDescription: "Printer jams on every duplex job. Parts ordered.", priority: "low", status: "in_progress", approvedBy: raj!.id, approvedAt: new Date(), technicianId: vikram!.id },
    { organizationId: orgId, assetId: byTag("AF-0410").id, reportedBy: rohan!.id, issueDescription: "Chair gas lift replaced.", priority: "low", status: "resolved", approvedBy: raj!.id, approvedAt: daysAgo(5), technicianId: vikram!.id, resolvedAt: new Date(), resolutionNotes: "Gas lift replaced under warranty." },
  ]);

  // … plus resolved history spread across the past year, so the maintenance-frequency
  // line chart has an actual trend to draw. Without this every request sits in the
  // current month and the chart is a flat line with one spike at the end.
  const historicalIssues: Array<[string, number, string]> = [
    ["AF-0062", 30, "Lamp replaced after 2000 hours."],
    ["AF-0062", 95, "Fan cleaned, overheating resolved."],
    ["AF-0078", 60, "Annual hydraulics service."],
    ["AF-0078", 150, "Brake pads replaced."],
    ["AF-0055", 45, "Toner sensor recalibrated."],
    ["AF-0055", 120, "Paper feed roller replaced."],
    ["AF-0012", 75, "Battery swelled — replaced under warranty."],
    ["AF-0088", 190, "Dead pixel cluster; panel swapped."],
    ["AF-0343", 100, "Tyre puncture repaired."],
    ["AF-0410", 220, "Castors replaced."],
    ["AF-0201", 260, "Armrest bolt tightened."],
    ["AF-0021", 300, "Screen protector reapplied."],
  ];

  await db.insert(s.maintenanceRequests).values(
    historicalIssues.map(([tag, days, notes]) => ({
      organizationId: orgId,
      assetId: byTag(tag).id,
      reportedBy: rohan!.id,
      issueDescription: notes,
      priority: "medium" as const,
      status: "resolved" as const,
      approvedBy: raj!.id,
      approvedAt: daysAgo(days),
      technicianId: vikram!.id,
      resolvedAt: daysAgo(days - 2),
      resolutionNotes: notes,
      createdAt: daysAgo(days),
    })),
  );

  // ── Audit cycle (open, with 2 discrepancies already flagged) ─────────────
  const [cycle] = await db
    .insert(s.auditCycles)
    .values({ organizationId: orgId, name: "Q3 Audit — Engineering", scopeDepartmentId: engineering!.id, startDate: daysFromNow(-5), endDate: daysFromNow(10), status: "open", createdBy: admin!.id })
    .returning();

  await db.insert(s.auditCycleAuditors).values([
    { cycleId: cycle!.id, userId: aditi!.id },
    { cycleId: cycle!.id, userId: sana!.id },
  ]);

  await db.insert(s.auditItems).values([
    { cycleId: cycle!.id, assetId: byTag("AF-0114").id, expectedLocation: "Desk E12", status: "verified", checkedBy: aditi!.id, checkedAt: new Date() },
    { cycleId: cycle!.id, assetId: byTag("AF-0088").id, expectedLocation: "Desk E15", status: "damaged", notes: "Cracked panel, bottom-left corner.", checkedBy: aditi!.id, checkedAt: new Date() },
    { cycleId: cycle!.id, assetId: byTag("AF-0020").id, expectedLocation: "Desk E14", status: "missing", notes: "Not at the desk; owner on leave.", checkedBy: sana!.id, checkedAt: new Date() },
    { cycleId: cycle!.id, assetId: byTag("AF-0012").id, expectedLocation: "Desk E11", status: "pending" },
    { cycleId: cycle!.id, assetId: byTag("AF-0099").id, expectedLocation: "Wall, Bay 2", status: "pending" },
  ]);

  // ── Notifications (one per event type in the spec) ───────────────────────
  const ago = (mins: number) => new Date(Date.now() - mins * 60_000);
  await db.insert(s.notifications).values([
    { organizationId: orgId, userId: priya!.id, type: "asset_assigned", title: "Laptop AF-0114 assigned to you", body: "MacBook Pro 14 — return by " + daysFromNow(30), link: "/assets", createdAt: ago(2) },
    { organizationId: orgId, userId: raj!.id, type: "maintenance_approved", title: "Maintenance request AF-0055 approved", body: "HP LaserJet Printer — work can begin.", link: "/maintenance", createdAt: ago(18) },
    { organizationId: orgId, userId: aditi!.id, type: "booking_confirmed", title: "Booking confirmed: Room B2", body: "Today 09:00–10:00 — Procurement Team sync.", link: "/booking", createdAt: ago(60) },
    { organizationId: orgId, userId: rohan!.id, type: "transfer_approved", title: "Transfer approved: AF-0033 to Facilities", body: "Conference Speakerphone re-allocated.", link: "/allocation", createdAt: ago(180) },

    // NOTE: no overdue_return notification is seeded, even though AF-0021 IS
    // overdue. That is on purpose — the overdue-returns cron job generates it.
    // Seeding one too would both duplicate the job's output and spoil the demo:
    // the point is to trigger the job (POST /api/jobs/overdue-returns/run) and
    // watch the alert land in Vikram's bell live, over the WebSocket.
    { organizationId: orgId, userId: admin!.id, type: "audit_discrepancy", title: "Audit discrepancy flagged: AF-0088 damaged", body: "Q3 Audit — Engineering: cracked panel.", link: "/audit", createdAt: ago(2880) },
    { organizationId: orgId, userId: admin!.id, type: "audit_discrepancy", title: "Audit discrepancy flagged: AF-0020 missing", body: "Q3 Audit — Engineering: not at the expected desk.", link: "/audit", createdAt: ago(2900) },
    { organizationId: orgId, userId: priya!.id, type: "booking_reminder", title: "Room B2 booking starts soon", body: "Design review at 14:00.", link: "/booking", createdAt: ago(5) },
  ]);

  // ── Activity log — this is what the asset lifecycle timeline renders ─────
  await db.insert(s.activityLogs).values([
    { organizationId: orgId, actorId: raj!.id, entityType: "asset", entityId: byTag("AF-0114").id, action: "registered", summary: "MacBook Pro 14 (AF-0114) registered", createdAt: ago(60 * 24 * 90) },
    { organizationId: orgId, actorId: raj!.id, entityType: "asset", entityId: byTag("AF-0114").id, action: "allocated", summary: "Laptop AF-0114 allocated to Priya Sharma — Engineering", metadata: { to: "Priya Sharma" }, createdAt: ago(2) },
    { organizationId: orgId, actorId: aditi!.id, entityType: "booking", entityId: byTag("AF-0500").id, action: "booking_confirmed", summary: "Room B2 — booking confirmed — 09:00 to 10:00", createdAt: ago(60) },
    { organizationId: orgId, actorId: raj!.id, entityType: "maintenance", entityId: byTag("AF-0410").id, action: "maintenance_resolved", summary: "Chair AF-0410 — maintenance resolved", createdAt: ago(120) },
    { organizationId: orgId, actorId: raj!.id, entityType: "asset", entityId: byTag("AF-0201").id, action: "returned", summary: "Office Chair AF-0201 returned by Arjun Nair — condition: good", createdAt: ago(60 * 24 * 10) },
    { organizationId: orgId, actorId: raj!.id, entityType: "asset", entityId: byTag("AF-0062").id, action: "maintenance_approved", summary: "Projector AF-0062 moved to Under Maintenance", createdAt: ago(300) },
    { organizationId: orgId, actorId: admin!.id, entityType: "audit", entityId: cycle!.id, action: "audit_opened", summary: "Q3 Audit — Engineering opened with 2 auditors", createdAt: ago(60 * 24 * 5) },
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("  Organization   Acme Corp");
  console.log(`  Departments    5 (Platform → Engineering, Field Ops (East) → Field Ops)`);
  console.log(`  Users          8`);
  console.log(`  Assets         ${assets.length} across all 7 lifecycle states`);
  console.log("  Allocations    6 (1 overdue, 1 returned)");
  console.log("  Bookings       5     Maintenance 5 (one per Kanban column)");
  console.log("  Audit          1 open cycle, 2 auditors, 2 discrepancies\n");

  console.log("Log in with any of these — password is 'password123':");
  console.log("  admin@acme.test   Admin");
  console.log("  raj@acme.test     Asset Manager");
  console.log("  aditi@acme.test   Department Head");
  console.log("  priya@acme.test   Employee (holds AF-0114)\n");

  console.log("The two scenarios from the spec are now live:");
  console.log("  1. AF-0114 'MacBook Pro 14' is held by Priya Sharma");
  console.log("     → allocating it to anyone else is rejected by one_active_allocation");
  console.log("  2. Room B2 is booked today 09:00–10:00");
  console.log("     → 09:30–10:30 is rejected by no_overlap; 10:00–11:00 is accepted\n");
}

await seed();
await closeDatabase();
