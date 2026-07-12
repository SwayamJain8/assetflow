<div align="center">

# AssetFlow

**Enterprise Asset & Resource Management**

Track assets through their lifecycle · Allocate without conflicts · Book shared
resources without overlaps · Route repairs through approval · Run audit cycles

[Database schema](docs/database-schema.md) · [Demo & verification](docs/DEMO.md) · [API docs](http://localhost:4000/api/docs)

</div>

---

## Run it

**One command** — Postgres, the API, and the UI:

```bash
cp .env.example .env          # then set JWT_SECRET (any 32+ chars)
docker compose up -d
docker compose exec api bun run db:seed
```

Open **http://localhost:3000**. The API migrates its own schema on boot.

<details>
<summary>Or run it locally without Docker</summary>

```bash
docker compose up -d postgres

cd backend  && bun install && bun run db:reset && bun dev    # API → :4000
cd frontend && bun install && bun dev                        # UI  → :3000
```
</details>

Every seeded account uses the password `password123`; the login screen offers all
four roles as one-click chips.

| Account | Role |
|---|---|
| `admin@acme.test` | Admin |
| `raj@acme.test` | Asset Manager |
| `aditi@acme.test` | Department Head |
| `priya@acme.test` | Employee — **holds AF-0114** |

---

## The idea

Two business rules are hard to get right, and almost everyone gets them wrong in
the same way: they check in application code.

> An asset cannot be held by two people at once.
> Two bookings of one resource cannot overlap.

A `SELECT`-then-`INSERT` check is a **race**. Two concurrent requests both see the
laptop as free, both write, and now it is held by two people. No amount of
application code closes that window.

**So AssetFlow does not check.** It attempts the write and lets PostgreSQL refuse
it:

```sql
-- an asset can have at most one open allocation
CREATE UNIQUE INDEX one_active_allocation
  ON allocations (asset_id) WHERE (returned_at IS NULL);

-- two bookings of one resource cannot overlap
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (resource_id WITH =, during WITH &&)
  WHERE (status <> 'cancelled');
```

The service layer catches the refusal and turns it into a message:

```
409 ASSET_ALREADY_ALLOCATED
"AF-0114 is currently held by Priya Sharma. Direct re-allocation is blocked —
 submit a transfer request instead."
```

**The database decides. The application explains.** That is the whole design, and
everything else follows from it. → [docs/database-schema.md](docs/database-schema.md)

---

## Stack

| | |
|---|---|
| **Backend** | Bun · Hono · Drizzle ORM · Zod · PostgreSQL 17 |
| **Frontend** | Next.js 16 (App Router) · React 19 · Tailwind v4 · TanStack Query |
| **Real-time** | Bun-native WebSocket |
| **Auth** | `Bun.password` (argon2) + `hono/jwt` — no bcrypt, no jsonwebtoken |
| **Docs** | OpenAPI generated from the same Zod schemas the routes validate against |

No backend-as-a-service. No ORM magic hiding the SQL. The two constraints that
matter are hand-written SQL in the migration, because Drizzle cannot express them —
and they are the point.

---

## Architecture

```
backend/src/
  config/         env (Zod-validated, fails fast) · db pool
  db/schema/      14 tables, 11 native enums          ← the centre of the project
  db/migrations/  committed SQL — the schema's history
  modules/        one folder per domain, each: schema.ts · service.ts · routes.ts
  middleware/     auth · RBAC · one error envelope
  services/       activity+notify+broadcast · storage · realtime
  jobs/           4 idempotent cron jobs

frontend/src/
  app/(auth)/     login · self-serve onboarding
  app/(app)/      the 9 signed-in screens
  components/     PageShell · DataTable · StatusPill · Modal · FormField · KpiCard
  lib/theme.ts    logo → WCAG-clamped palette
  hooks/          useRealtime — WebSocket → query invalidation
```

**Business rules live in services, never in controllers.** A route handler reads the
user, calls a service, and returns JSON — five lines.

**Errors have exactly one shape**, and the client never re-implements a rule:

```json
{ "error": { "code": "...", "message": "...", "details": [ { "field": "email", "message": "..." } ] } }
```

`FormField` renders `details[].field` under the offending input, so the message a
user reads is the one the **server** decided — including rules only the *database*
knows, like a duplicate email or an overlapping booking.

---

## The four things that make it different

**Real-time everything.** Allocate an asset in one tab; the dashboard KPIs and the
activity feed change in another, with no reload. The socket carries **no data** —
only `{"type":"invalidate","keys":[...]}`. The client refetches through the normal
authenticated API, so real-time cannot leak anything and no query is reimplemented
for the wire.

**Logo → theme.** Upload an organization's logo and the entire app re-skins,
instantly. The palette is extracted in the browser and **clamped for WCAG contrast**
— saturation and lightness are forced into a legible range while the *hue* is
preserved. A neon-yellow logo cannot produce an unreadable button. 19 tests cover
hostile logos.

**Asset lifecycle timeline.** Every asset shows its whole journey: registered →
allocated → sent for maintenance → returned → re-allocated. It is a **query over
`activity_logs`**, the table every mutation already writes to. No timeline table, so
nothing can drift from what actually happened.

**⌘K palette.** Server-side search across assets and people, plus quick actions and
navigation, from any screen.

---

## Verify it

```bash
cd backend  && bun test           # 11 — both constraints, against a real PostgreSQL
cd frontend && bun test src/lib   # 19 — the WCAG theme clamp
cd frontend && node e2e/smoke.mjs # 11 — drives real Chromium against the real API
```

The constraint tests run against **real PostgreSQL**, not a mock — a test that
stubbed the database would prove nothing, because the guarantees *live* in the
database.

**Every claim in this README can be checked in one paste:**
→ [docs/DEMO.md](docs/DEMO.md)

---

## The 10 screens

Login · Dashboard · Organization Setup · Assets · Allocation & Transfer ·
Resource Booking · Maintenance (Kanban) · Audit · Reports · Notifications

All built, all wired to real data, all responsive.
