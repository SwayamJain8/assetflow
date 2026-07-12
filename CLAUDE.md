# AssetFlow — Project Memory (read this first)

This file is the persistent context for this project. It captures the goal, the
decisions already made, the architecture, and the rules that must be enforced.
Read it fully before writing code. The complete original spec is in
`docs/problem-statement.md`. Wireframe mockups for every screen are in
`docs/mockups/` (PNG per screen) — match their layout and design.

---

## 1. What we are building

**AssetFlow — Enterprise Asset & Resource Management System.**
A **responsive web application** (works in desktop and mobile browsers — it is
NOT a native mobile app) that lets any organization track its physical assets and
shared resources: register assets, allocate them to people/departments, book
shared resources (rooms/vehicles), run a maintenance approval workflow, run audit
cycles, and see everything on a KPI dashboard. It deliberately does NOT touch
purchasing, invoicing, or accounting.

## 2. Why we are building it — the hackathon context (OPTIMIZE FOR THIS)

This is an **Odoo hiring hackathon**. The organizers said explicitly: *"This
hackathon isn't about coding fast. It's about approaching the problem thoughtfully
and designing scalable, well-structured, clear code."* They are hiring developers.

**Judging criteria — build to score on these, in priority order:**

1. **Database design — stated as the MOST important thing. Prioritize the schema
   above everything else.**
2. Backend APIs built **from scratch** with a **local database (PostgreSQL)**.
   **Do NOT use Firebase, Supabase, or MongoDB Atlas / any backend-as-a-service.**
   Minimize third-party APIs.
3. **Real, dynamic data** — data created through the app and stored in the DB.
   Static JSON is fine only for quick prototyping, never for the final solution.
   (Ship a realistic seed script so demos show live data.)
4. **Robust input validation + graceful error handling** (e.g. invalid email must
   show a clear "invalid email" message). Validate on the backend, always.
5. **Proper Git usage** — frequent, meaningful commits; clean history.
6. **Clean, interactive UI** — consistent color scheme, consistent layout,
   intuitive navigation, good spacing and flow. (Design system in section 7.)
7. Also judged: coding standards, logic, **modularity**, performance,
   **scalability**, **security**, usability, debugging, modular architecture,
   coding patterns, attention to detail.
8. Trendy tech (AI/chatbot/etc.) only if it genuinely adds value. Understand every
   tool used — no blind copy-paste.

**Winning principle:** depth over breadth. A correct, well-designed database and a
few hard features done cleanly beats a broad but shallow app. Design the schema
first; everything hangs off it.

## 3. Tech stack (CONFIRMED)

- **Platform:** responsive web app (not native mobile).
- **Team:** solo developer.
- **Repository:** ONE repo named `assetflow` (monorepo) with two clearly separate
  folders — `backend/` and `frontend/`. Not two separate repos.
- **Runtime/language:** **Bun + TypeScript** (backend). Bun for speed, built-in
  TypeScript, built-in test runner, built-in SQL client, and one toolchain.
- **Backend web framework:** **Hono** (fast, Bun-friendly, huge community). NOTE:
  Zod is a *validation library*, not a framework — it does NOT replace the
  framework; it's the validation layer on top of it.
- **Validation:** **Zod** — every request body/query is parsed against a Zod schema
  in middleware; invalid input returns a clear, specific error message. Zod also
  drives auto-generated OpenAPI/Swagger docs via `@hono/zod-openapi`, and shares
  types with the DB layer via `drizzle-zod`.
- **Database:** **PostgreSQL**, self-hosted in Docker. No BaaS.
- **DB access:** **Drizzle ORM** (TypeScript-first, schema-as-code, controlled SQL
  migrations — great for showing off the schema). Drop to **raw SQL** for the two
  showpiece constraints below to demonstrate real DB skill.
- **Frontend:** **Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4**
  — deployed to **Vercel**. Scaffolded with `src/` dir, ESLint, and the `@/*` import
  alias. NOTE: Next 16 has breaking changes vs older Next — see `frontend/AGENTS.md`
  and consult `node_modules/next/dist/docs/` before writing Next-specific code.
  The backend stays a **separate** Hono API on EC2; Next is a pure client of it —
  do NOT move business logic into Next route handlers/server actions.
  Supporting libs: Framer Motion (motion), TanStack Query (data + real-time),
  TanStack Table (data grids), Recharts (charts), node-vibrant (extract theme
  colors from an org's logo — see 7.2). Build a *custom*, brand-adaptive themed
  component set — see 7.1/7.2, do NOT ship a generic off-the-shelf look.
- **Backend deploy:** **AWS EC2 via Docker** (base image `oven/bun`), with
  PostgreSQL alongside (docker-compose for local + EC2).
- **Auth:** email + password (hashed), JWT/session, with role-based access control.

## 4. Architecture & folder structure

```
assetflow/
├── CLAUDE.md                 ← this memory file
├── README.md
├── .gitignore                ← ignore node_modules, .env, build output
├── docker-compose.yml        ← runs backend + PostgreSQL together
├── docs/
│   ├── problem-statement.md  ← full original spec
│   ├── database-schema.md    ← ER diagram / schema (BUILD THIS FIRST)
│   └── mockups/              ← wireframe PNG per screen (design reference)
├── backend/                  ← API + DB logic → deploys to EC2 via Docker
│   ├── Dockerfile
│   ├── .env.example
│   └── src/
│       ├── config/           ← DB connection, env config
│       ├── db/
│       │   ├── schema/       ← Drizzle table definitions (THE SCHEMA — #1)
│       │   └── migrations/   ← generated SQL migrations
│       ├── modules/          ← one folder per domain (assets, allocation,
│       │                        booking, maintenance, audit, ...), each with its
│       │                        own routes + controller + service
│       ├── middleware/       ← auth, validation, error handling
│       ├── services/         ← cross-cutting services (notifications, etc.)
│       ├── jobs/             ← cron / scheduled jobs (overdue flags, reminders)
│       └── utils/
└── frontend/                 ← Next.js 16 App Router → deploys to Vercel
    ├── AGENTS.md             ← Next 16 breaking-change notice (read before coding)
    ├── next.config.ts
    ├── public/
    └── src/
        └── app/              ← App Router: one route folder per screen (section 7)
            ├── layout.tsx    ← sidebar + wordmark shell (shared by every screen)
            ├── globals.css   ← Tailwind v4 + CSS custom props (theme tokens, 7.2)
            ├── (auth)/       ← login — outside the sidebar shell
            └── (app)/        ← dashboard, assets, allocation, booking,
                                 maintenance, audit, reports, notifications
        ├── components/       ← reusable UI pieces (cards, tables, pills, modals)
        ├── lib/api/          ← typed fetch client for the Hono backend
        └── context/          ← shared state (logged-in user, role, theme)
```

**Modularity rule:** each domain lives in its own module folder with its business
rules in a `service`. Keep rules out of controllers. This directly serves the
"modular architecture" judging criterion.

## 5. Database-design SHOWPIECES (these win the #1 criterion — do them at DB level)

Enforce the two hardest rules in the DATABASE itself, not just in app code. This
is the single biggest way to impress reviewers grading database design, and it
also removes race conditions.

1. **No overlapping bookings for the same resource** → PostgreSQL
   **EXCLUSION CONSTRAINT** using the `btree_gist` extension on a `tstzrange`:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ALTER TABLE bookings ADD CONSTRAINT no_overlap
     EXCLUDE USING gist (resource_id WITH =, during WITH &&)
     WHERE (status <> 'cancelled');
   ```
   The database physically rejects any overlapping slot. Most candidates only
   check in application code (which has race conditions) — this is a standout.

2. **An asset can have at most one active allocation** → PostgreSQL
   **PARTIAL UNIQUE INDEX**:
   ```sql
   CREATE UNIQUE INDEX one_active_allocation
     ON allocations (asset_id) WHERE (returned_at IS NULL);
   ```
   The database guarantees a laptop can't be held by two people at once.

Also apply throughout: foreign keys with sensible ON DELETE, CHECK constraints or
native ENUM types for status fields, indexes on lookup columns, and the
self-referential `parent_department_id` for department hierarchy. Document all of
this in `docs/database-schema.md` with an ER diagram.

## 6. Build order — the "spine" (do these first, in order)

1. **Auth + roles** — signup creates an **Employee only**; roles assigned ONLY by
   an Admin (no self-elevation). RBAC enforced in middleware.
2. **Organization setup** — departments (with optional parent → hierarchy), asset
   categories (with optional category-specific fields), employee directory.
3. **Asset registration + lifecycle** — auto asset tag (AF-0001), states:
   Available, Allocated, Reserved, Under Maintenance, Lost, Retired, Disposed.
4. **Allocation + transfer** ⭐ SHOWPIECE — partial-unique-index prevents
   double-allocation; block + offer Transfer Request (Requested → Approved →
   Re-allocated); return flow with condition notes.
5. **Resource booking** ⭐ SHOWPIECE — time-slot booking with the exclusion
   constraint above; calendar/timeline view.
6. **Maintenance workflow** — Kanban board (Pending → Approved → Technician
   Assigned → In Progress → Resolved); approving flips asset to Under Maintenance,
   resolving flips it back to Available.
7. **Dashboard + KPIs** — Available, Allocated, Maintenance Today, Active Bookings,
   Pending Transfers, Upcoming/Overdue Returns + recent activity.

**Then (high value, do next):** notification service, cron jobs, audit cycles,
reports & analytics, activity log. See sections 8–9.

## 7. UI design system + screen inventory (from docs/mockups/)

The mockups are a **dark theme** with a consistent left-sidebar layout. Match this
for the "consistent color scheme / clean UI" criterion.

- **Layout:** fixed left sidebar (nav) + top wordmark "AssetFlow" + main content
  area of cards/tables. Same on every screen.
- **Sidebar items (nav order):** Dashboard, Organization setup, Assets,
  Allocation & Transfer, Resource Booking, Maintenance, Audit, Reports,
  Notifications.
- **The palette is DYNAMIC per organization** (generated from the uploaded logo —
  see 7.2), applied via CSS custom properties so the whole app re-themes at once.
  Define semantic tokens (`--color-primary`, `--color-surface`, `--color-danger`,
  etc.), NOT hard-coded hexes. Support BOTH light and dark for every theme.
- **Default theme** (used before a logo is set): near-black surfaces with a
  teal/violet accent; success = green, danger = red, warning = amber. Status pills
  rounded; tables with thin borders. This is only the fallback — brand themes
  override it.

**Screens (10):** Login (centered card, "signup = employee, roles assigned
later"), Dashboard (6 KPI cards + red overdue banner + quick actions + recent
activity), Organization Setup (tabs: Departments/Categories/Employee + Add;
tables with status pills), Assets (search by tag/serial/QR + filter chips + table),
Allocation & Transfer (asset picker + red "already allocated" block + transfer
form + allocation history), Resource Booking (resource picker + time grid showing
booked vs conflicting slots), Maintenance (**Kanban board** with 5 columns), Audit
(cycle header + Verified/Missing/Damaged checklist + auto discrepancy banner +
Close cycle), Reports (utilization bar chart, maintenance-frequency line chart,
most-used/idle lists, export), Notifications (filter tabs All/Alerts/Approvals/
Bookings + timestamped feed).

## 7.1 Make the UI STAND OUT — do NOT clone the mockups

IMPORTANT: the wireframes in `docs/mockups/` were provided BY the hackathon
organizers, so every team receives them and most entries will look nearly
identical. Treat the mockups as the **minimum required content** of each screen
(which fields, tables, and actions must exist) — NOT as the visual design. We win
by keeping the same information + navigation (so it stays intuitive, a judged
criterion) while giving AssetFlow a distinctive, polished identity the evaluators
have not already seen 20 times that day.

**Design identity — premium, polished, and CUSTOMIZABLE.** Both a refined dark mode
and a light mode; crisp typography with monospaced numerals for KPI figures;
generous spacing, thin dividers, subtle depth. The signature idea is that the theme
is **not fixed** — it is generated per organization from their uploaded logo (see
7.2). A tasteful default (teal/violet accent) is used only until a logo is set.
Consistency + craft is the goal (also judged) — never visual chaos.

**Signature differentiators — solo dev: pick 3–4 and execute flawlessly; do NOT
half-build many:**
- **Real-time everything** (WebSocket, Bun-native): dashboard KPIs, notification
  bell, maintenance Kanban, and booking grid update live without refresh. The
  single biggest "this one is different" signal vs everyone's static CRUD.
- **Command palette (Cmd/Ctrl-K):** fuzzy search + quick actions across assets,
  people, and rooms. Instantly reads as a professional product.
- **Asset lifecycle timeline:** a per-asset visual timeline of its journey
  (registered → allocated → maintenance → returned → …). Unique, and it visualizes
  your history tables — reinforcing the database-design story.
- **Booking as a real timeline/Gantt** with drag-to-create and live conflict
  highlighting (ties directly to the exclusion constraint).
- **Motion & feedback:** smooth transitions (Framer Motion), animated status-pill
  changes, skeleton loaders, toast validation feedback → attention-to-detail points.
- **Role-tailored dashboards:** each role lands on a purpose-built home, not one
  generic page. Shows thoughtful UX.
- **QR scan flow:** scan an asset's QR via webcam to jump straight to it — very
  demoable.

**Guardrails (honest):**
- Unique must stay USABLE. Judges score usability, intuitive navigation, and
  consistency. Keep the sidebar + screen structure; differentiate through visual
  craft, motion, real-time, and a couple of signature views — never at the cost of
  clarity.
- As a solo dev, the risk isn't ambition — it's sequencing. Ship the required
  content of every screen first, THEN layer the differentiators in priority order.
  This guarantees that if time runs short, what's finished is always the most
  important part, never a half-built mess. The target remains: all of them.

## 7.2 Dynamic per-organization theming (SIGNATURE FEATURE)

When an organization is created (onboarding), the admin uploads the company logo,
and the app **intelligently generates the whole theme from that logo** and re-skins
the entire UI to match the brand — a white-label / brand-adaptive experience most
teams will not attempt. Upload logo → watch the app re-skin live = a memorable demo.

How it works:
1. On logo upload, extract a color palette from the image (`node-vibrant` /
   `colorthief`) → vibrant / muted / dark / light swatches.
2. Derive semantic theme tokens: primary accent + hover/active shades, surface and
   background tints. Keep success/danger semantically stable (green/red) but
   harmonized to the brand.
3. Generate BOTH a light and a dark variant from the same brand color.
4. **Intelligence = accessibility clamping:** enforce WCAG contrast for text on
   surfaces, and clamp extreme saturation/lightness so even a wild logo yields a
   readable, tasteful theme. This thoughtful handling is what makes it impressive
   rather than gimmicky — call it out to judges.
5. Store the generated tokens on the Organization record (JSON `theme`). Apply at
   runtime as CSS custom properties on the app root; Tailwind reads the variables,
   so the whole app re-themes instantly and consistently.
6. Provide a manual accent override + a light/dark toggle.

This makes theming a real, database-backed feature (Organization.theme), reinforces
"attention to detail" and "scalability" (multi-org), and is genuinely memorable.

## 8. Notification service (in scope)

A `notifications` table + service that other modules call. Events (from spec):
Asset Assigned, Maintenance Approved/Rejected, Booking Confirmed/Cancelled/Reminder,
Transfer Approved, Overdue Return Alert, Audit Discrepancy Flagged. Expose a feed
API with filter tabs (All/Alerts/Approvals/Bookings).
- **Impress upgrade:** push live updates with **WebSockets/SSE** (Bun has native
  WebSocket support) so the notification bell updates in real time.
- Email is optional; keep in-app as primary to avoid third-party dependence.

## 9. Cron / scheduled jobs (in `backend/src/jobs/`)

Scheduled workers (use a small scheduler lib or Bun's scheduling). Jobs:
- Flag overdue allocations (past Expected Return Date) daily → notifications +
  dashboard.
- Booking reminders before a slot starts.
- Assets due for maintenance / nearing retirement alerts.
- Overdue audit cycles.
- **Upgrade path (note, don't build now):** move to a Redis-backed job queue
  (BullMQ) when scaling beyond one instance.

## 10. Bonus features — ranked by impress-to-effort (do top-down as time allows)

High impress / low effort:
- **Auto API docs** via `@hono/zod-openapi` → Swagger UI (near-free; showcases API design).
- **Realistic seed script** (satisfies "real dynamic data"; makes demos shine).
- **Dark/light theme toggle** (mockups are already dark).
- **QR code** per asset (spec mentions QR search) — generate + scan to open asset.
- **CSV/PDF export** of reports.

High impress / medium effort:
- The two **DB-level constraints** in section 5 (this is the biggest win).
- **Real-time notifications** (WebSocket/SSE bell).
- **Kanban drag-and-drop** for maintenance — dragging a card triggers the workflow
  + asset status change (very demoable).
- **Dashboard/report charts** (utilization, maintenance frequency, booking heatmap).
- **Global search / command palette** (Cmd-K).

Optional / only if it truly adds value (judges' note on trendy tech):
- AI natural-language search ("idle laptops in Bengaluru") or AI summary of audit
  discrepancies. Keep late; don't let it distract from the core.

## 11. Business rules that MUST be enforced (judges will test these)

- Signup → Employee role only. Admin promotes to Department Head / Asset Manager
  from the Employee Directory. This is the ONLY place roles are assigned.
- An asset cannot be allocated to two people at once (enforced by partial unique
  index). If already held: block, show "currently held by <name>", offer a
  Transfer Request.
- Transfer workflow: Requested → Approved (Asset Manager / Dept Head) →
  Re-allocated, with allocation history updated automatically.
- Two bookings for the same resource cannot overlap (enforced by exclusion
  constraint). 9:00–10:00 booked → 9:30–10:30 rejected; 10:00–11:00 allowed.
- Maintenance must be Approved before work; on approval asset → Under Maintenance,
  back to Available on resolution.
- Overdue allocations auto-flagged → dashboard + notifications (via cron).
- Audit cycle: assign auditors → mark each asset Verified/Missing/Damaged →
  auto-generate discrepancy report → closing locks the cycle and updates asset
  statuses (confirmed-missing → Lost).
- Validate all input; return clear, specific error messages.

## 12. User roles

- **Admin** — manages departments, categories, audit cycles, and role assignment;
  org-wide analytics.
- **Asset Manager** — registers/allocates assets; approves transfers, maintenance,
  returns, and audit discrepancy resolution.
- **Department Head** — views/approves allocations & transfers within their
  department; books resources for the department.
- **Employee** — views own assets; books resources; raises maintenance requests;
  initiates return/transfer requests.

## 13. Data model (core entities — full detail in docs/problem-statement.md)

**Organization / Tenant** (name, uploaded logo, generated `theme` tokens JSON,
settings) — the top-level entity created at onboarding. Core tables carry an
`organization_id` so the system is multi-org by design (add it up front; retrofitting
tenancy later is painful, and it strengthens the "scalability" score).

Department (self-referential parent for hierarchy), AssetCategory (with optional
custom fields), User/Employee (with role + status), Asset (with lifecycle status,
tag, serial, location, cost), Allocation (asset ↔ holder, expected return date,
returned_at, condition notes), TransferRequest, Resource/bookable flag, Booking
(resource + tstzrange time slot + status), MaintenanceRequest (workflow status,
priority, technician), AuditCycle, AuditItem (verified/missing/damaged),
Notification, ActivityLog.

## 14. Coding standards

- Layered/modular: db schema → services (business rules) → controllers → routes.
- All secrets in environment variables; never commit `.env` (commit `.env.example`).
- Validate input on the backend (never trust the frontend alone).
- Consistent naming; UI uses shared components + the palette in section 7.
- Frequent, meaningful Git commits (e.g. `feat(booking): enforce no-overlap via
  exclusion constraint`).

## 14.1 Local ports & conventions (established)

- **Backend API: `localhost:4000`** (NOT 3000 — Next.js dev owns 3000). All routes
  are under `/api`. Swagger UI at `/api/docs`, spec at `/api/openapi.json`.
- **Frontend: `localhost:3000`** (Next default). It is the only allowed CORS origin
  by default; add the Vercel URL to `CORS_ORIGINS` on deploy.
- **Postgres: `localhost:5432`** via `docker compose up -d postgres`.
- **Two `.env` files, both gitignored:** root `.env` (read by docker-compose only)
  and `backend/.env` (read by the API). Both have committed `.env.example` twins.
- **Env is validated by Zod at boot** in `backend/src/config/env.ts` — a bad or
  missing value exits the process with a clear message instead of failing later.
  Never read `process.env` anywhere else; import `env` from that module.
- **Errors have ONE shape** (`backend/src/middleware/error-handler.ts`):
  `{ error: { code, message, details? } }`. `AppError` is for business-rule
  failures. The handler already translates PostgreSQL error codes into friendly
  messages — including `23P01` (exclusion violation → booking overlap) and the
  `one_active_allocation` unique violation → "already allocated". **The DB rejects
  it; this layer explains it.** Keep that contract when adding the real tables.
- **Validation failures** are caught by the `defaultHook` in `app.ts` and return
  422 naming the exact field, satisfying the "invalid email → clear message" test.
- **Migrations are committed** (`backend/src/db/migrations/`). Use
  `bun db:generate` + `bun db:migrate`; never `drizzle-kit push` for real changes.

## 15. Current status

**Scaffolding is DONE and verified running. No commits yet.**

- `.gitignore` written (root, covers both halves). AI-tool config clutter is
  ignored; `docs/` + `CLAUDE.md` are tracked.
- `frontend/` — Next.js 16 App Router + React 19 + Tailwind v4 + TS. `bun run build`
  passes. Still the stock starter page; no AssetFlow UI yet.
- `backend/` — Bun + Hono + Drizzle + Zod, layered per section 4
  (`config/`, `db/schema/`, `modules/`, `middleware/`, `services/`, `jobs/`).
  Verified live: `GET /api/health` → `{"status":"ok","database":"up"}`, Swagger UI
  at `/api/docs`. Only the health module exists so far.
- `docker-compose.yml` (root) runs Postgres 17 + the API; `backend/Dockerfile` is a
  multi-stage `oven/bun:1.3-alpine` build, non-root, with a healthcheck.
- Auth will use **Bun's built-in `Bun.password`** (argon2) and **`hono/jwt`** — no
  bcrypt/jsonwebtoken dependency needed.

**Next steps:** (1) design the schema in `docs/database-schema.md` with the two
showpiece constraints, (2) write the Drizzle tables in `backend/src/db/schema/`
and generate the first migration (add `CREATE EXTENSION btree_gist` there),
(3) build the spine in section 6 order. Make the first Git commit now — the repo
still has zero commits, and "proper Git usage" is a judged criterion.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
