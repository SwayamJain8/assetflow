# AssetFlow — Enterprise Asset & Resource Management System (Full Problem Statement)

> Source: official Odoo hackathon problem statement PDF. This is the complete,
> faithful transcription for reference. See `../CLAUDE.md` for the strategy and
> decisions.
>
> Original mockup (POC): https://app.excalidraw.com/l/65VNwvy7c4X/5ceOBMjbDby

## Overall Vision

Simplify and digitize how organizations track, allocate, and maintain their
physical assets and shared resources through a centralized ERP platform. It is not
tied to any single industry — any organization with equipment, furniture,
vehicles, or shared spaces (offices, schools, hospitals, factories, agencies) can
use it.

The platform reduces manual tracking inefficiencies (spreadsheets, paper logs) by
enabling structured asset lifecycles, centralized resource booking, and real-time
visibility into who holds what, where it is, and its condition.

AssetFlow focuses on core ERP functionality with clean architecture, role-based
workflows, and scalable module design — **without** touching purchasing,
invoicing, or accounting.

## Mission

Build a user-centric, responsive application that lets staff:

- Set up departments, asset categories, and the employee directory
- Register and track assets through their full lifecycle
- Allocate assets to employees/departments with conflict handling
- Book shared resources (rooms, vehicles, equipment) without overlaps
- Run a structured maintenance approval workflow
- Run structured audit cycles to catch discrepancies
- Get notified of overdue returns, bookings, and maintenance events

## Problem Statement

Design and develop an Enterprise Asset & Resource Management System where
organizations can:

- Maintain departments, asset categories, and an employee directory
- Track assets through a flexible lifecycle (states: Available, Allocated,
  Reserved, Under Maintenance, Lost, Retired, Disposed) with transitions between
  states (e.g. Available ↔ Under Maintenance, Allocated → Available)
- Allocate assets to employees/departments, preventing double-allocation of a
  single asset
- Book shared/limited resources by time slot, with overlap validation
- Route maintenance requests through an approval workflow before repair starts
- Run scheduled audit cycles with assigned auditors and auto-generated discrepancy
  reports
- Surface overdue returns, bookings, and maintenance activity through
  notifications and a KPI dashboard

The application must demonstrate proper ERP architecture, reusable modules, secure
role-based workflows (with realistic account creation — not self-assigned admin
roles), and intuitive UI/UX, handling relationships between departments, employees,
assets, bookings, maintenance requests, and audits.

## Features (Screens)

### 1. Login / Signup Screen
Authenticate users with realistic, non-self-elevating account creation.
- Signup creates an **Employee account only** — no role selection at signup.
- Admin creates/promotes Department Heads and Asset Managers from the Employee
  Directory (Screen 3).
- Email & password login, forgot password, session validation.

### 2. Dashboard / Home Screen
Give every role a real-time operational snapshot.
- KPI cards: Assets Available, Assets Allocated, Maintenance Today, Active
  Bookings, Pending Transfers, Upcoming Returns.
- Overdue returns (past Expected Return Date) highlighted separately from upcoming.
- Quick actions: Register Asset, Book Resource, Raise Maintenance Request.

### 3. Organization Setup Screen (Admin only — 3 tabs)
Maintain the master data everything else depends on.
- **Tab A — Department Management:** create/edit/deactivate department; assign
  Department Head, optional Parent Department (hierarchy), Status (Active/Inactive).
- **Tab B — Asset Category Management:** create/edit categories (Electronics,
  Furniture, Vehicles, etc.); optional category-specific fields (e.g. warranty
  period for Electronics).
- **Tab C — Employee Directory:** Name, Email, Department, Role, Status; Admin
  promotes an Employee to Department Head or Asset Manager here — the ONLY place
  roles are assigned.

### 4. Asset Registration & Directory Screen
Register assets and search/track them centrally.
- Register: Name, Category (Screen 3), auto-generated Asset Tag (e.g. AF-0001),
  Serial Number, Acquisition Date, Acquisition Cost (for ranking/reports only, not
  linked to accounting), Condition, Location, photo/documents, "shared/bookable"
  flag.
- Search/filter by Asset Tag, Serial Number, QR code, category, status,
  department, or location.
- Lifecycle status per asset: Available, Allocated, Reserved, Under Maintenance,
  Lost, Retired, Disposed.
- Per-asset history: allocation history + maintenance history.

### 5. Asset Allocation & Transfer Screen
Manage who holds what, with explicit conflict rules.
- Allocate asset to employee/department with optional Expected Return Date.
- **Conflict rule:** cannot allocate an asset that's already taken. Example: Priya
  has Laptop AF-0114. If Raj tries to allocate it, the system blocks it, shows
  "currently held by Priya," and offers a Transfer Request button instead.
- Transfer workflow: Requested → Approved (Asset Manager/Department Head) →
  Re-allocated (history updated automatically).
- Return flow: mark returned, capture condition check-in notes, asset reverts to
  Available.
- Overdue allocations (past Expected Return Date) auto-flagged → Dashboard +
  Notifications.

### 6. Resource Booking Screen
Time-slot booking of shared resources with no overlaps.
- Calendar view of a resource's existing bookings.
- **Overlap validation:** two people can't book the same room at overlapping times.
  Room B2 booked 9:00–10:00 → request for 9:30–10:30 rejected (overlaps); request
  for 10:00–11:00 is fine (starts right after).
- Booking status: Upcoming, Ongoing, Completed, Cancelled.
- Cancel/reschedule; reminder notification before the slot starts.

### 7. Maintenance Management Screen
Route repairs through approval before work starts.
- Raise request: select asset, describe issue, set priority, attach photo.
- Workflow: Pending → Approved / Rejected (Asset Manager) → Technician Assigned →
  In Progress → Resolved.
- Asset status auto-updates to Under Maintenance on approval, back to Available on
  resolution.
- Maintenance history retained per asset.

### 8. Asset Audit Screen
Run structured verification cycles instead of a single form.
- Create an Audit Cycle (scope: department/location, date range).
- Assign one or more auditors to the cycle.
- Auditor marks each asset: Verified / Missing / Damaged.
- System auto-generates a discrepancy report for flagged items.
- Close Audit Cycle — locks the cycle and updates affected asset statuses (e.g.
  Lost for confirmed-missing items).
- Audit history retained per cycle.

### 9. Reports & Analytics Screen
Give managers actionable operational insight.
- Asset utilization trends; most-used vs. idle assets.
- Maintenance frequency by asset/category.
- Assets due for maintenance or nearing retirement.
- Department-wise allocation summary.
- Resource booking heatmap (peak usage windows).
- Exportable reports.

### 10. Activity Logs & Notifications Screen
Keep every role informed without digging for updates.
- Notification examples: Asset Assigned, Maintenance Approved/Rejected, Booking
  Confirmed/Cancelled/Reminder, Transfer Approved, Overdue Return Alert, Audit
  Discrepancy Flagged.
- Full audit log of admin/manager/employee actions (who did what, when).

## User Roles

- **Admin:** manages departments, asset categories, audit cycles, and
  employee/role assignment (Organization Setup); views org-wide analytics.
- **Asset Manager:** registers and allocates assets; approves transfers,
  maintenance requests, and audit discrepancy resolution; approves asset returns
  and condition check-in notes.
- **Department Head:** views assets allocated to their department; approves
  allocation/transfer requests within their department; books shared resources on
  behalf of the department.
- **Employee:** views assets allocated to them; books shared resources; raises
  maintenance requests; initiates return/transfer requests.

## Basic Workflow

1. Admin sets up departments, asset categories, and promotes select employees to
   Department Head / Asset Manager.
2. Asset Manager registers a new asset → enters as Available.
3. Asset is allocated to an employee/department (blocked if already allocated — a
   transfer request is required instead) or marked as a shared bookable resource.
4. Employees book shared resources by time slot; overlapping requests are rejected
   automatically.
5. If an asset needs repair, the holder raises a maintenance request, which must be
   approved before work begins and before the asset flips to Under Maintenance.
6. Assets are transferred or returned as needs change; overdue returns are flagged
   automatically.
7. Periodic audit cycles assign auditors, verify assets, and auto-generate
   discrepancy reports before closing.
8. All activity is tracked through notifications, logs, and reports.
