# AssetFlow — Demo & Verification

Every claim in this project can be checked in one paste. This document is the
script.

---

## Start it

**One command** — Postgres, the API, and the UI:

```bash
cp .env.example .env          # then set JWT_SECRET (any 32+ chars)
docker compose up -d
docker compose exec api bun run db:seed
```

The API applies its own migrations on boot, so there is no separate migrate step.
(`drizzle-kit` is a dev dependency and is absent from the production image — the
migration runs in-process instead.)

Or, without Docker:

```bash
docker compose up -d postgres
cd backend  && bun install && bun run db:reset && bun dev   # API  → :4000
cd frontend && bun install && bun dev                       # UI   → :3000
```

The seed creates realistic data — including the exact two scenarios the spec names.

**Sign in at http://localhost:3000 — every account's password is `password123`.**
The login screen lists all four as one-click chips.

| Email | Role | Why you'd use it |
|---|---|---|
| `admin@acme.test` | Admin | Organization setup, audit cycles, run cron jobs |
| `raj@acme.test` | Asset Manager | Register, allocate, approve |
| `aditi@acme.test` | Department Head | Approve transfers |
| `priya@acme.test` | Employee | **Holds AF-0114** — the star of scenario 1 |

---

## The two scenarios the spec names

### 1. "Priya has Laptop AF-0114. If Raj tries to allocate it, the system blocks it."

**In the UI:** sign in as **Raj** → *Allocation & Transfer* → search `AF-0114`.

You get the red block: *"Already allocated to Priya Sharma (Engineering) — Direct
re-allocation is blocked."*

Then click **"Attempt it anyway → see the database refuse it"**. That fires the real
`POST` and prints the database's own answer, because a UI that merely greys out a
button has prevented nothing — `curl` would still get through.

**By API:**

```bash
API=http://localhost:4000/api
RAJ=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"raj@acme.test","password":"password123"}' | jq -r .token)

LAPTOP=$(curl -s "$API/assets?q=AF-0114" -H "Authorization: Bearer $RAJ" | jq -r '.[0].id')
RAJ_ID=$(curl -s "$API/users?q=raj"      -H "Authorization: Bearer $RAJ" | jq -r '.[0].id')

curl -s -X POST $API/allocations -H "Authorization: Bearer $RAJ" \
  -H 'Content-Type: application/json' \
  -d "{\"assetId\":\"$LAPTOP\",\"holderUserId\":\"$RAJ_ID\"}" | jq
```

```json
{
  "error": {
    "code": "ASSET_ALREADY_ALLOCATED",
    "message": "AF-0114 is currently held by Priya Sharma. Direct re-allocation is blocked — submit a transfer request instead.",
    "details": {
      "holder": { "name": "Priya Sharma", "department": "Engineering" },
      "canRequestTransfer": true
    }
  }
}
```

> There is **no availability check** before that insert. The insert is attempted and
> PostgreSQL's partial unique index refuses it. A `SELECT`-then-`INSERT` check would
> be a race: two concurrent requests would both see the laptop as free.

### 2. "Room B2 booked 9:00–10:00 → 9:30–10:30 rejected; 10:00–11:00 is fine."

**In the UI:** sign in as **Priya** → *Resource Booking* → pick **Room B2**.
The 09:00–10:00 booking is on the grid. Click a free slot and try 09:30–10:30 —
the clashing rows flash **red**. Try 10:00–11:00 — it books.

**By API** (times are ISO instants; 03:30Z = 09:00 IST):

```bash
B2=$(curl -s "$API/resources" -H "Authorization: Bearer $RAJ" | jq -r '.[] | select(.name=="Room B2") | .id')
D=$(date -d tomorrow +%F 2>/dev/null || date -v+1d +%F)

# 09:00–10:00 — the existing booking
curl -s -X POST $API/bookings -H "Authorization: Bearer $RAJ" -H 'Content-Type: application/json' \
  -d "{\"resourceId\":\"$B2\",\"startsAt\":\"${D}T03:30:00Z\",\"endsAt\":\"${D}T04:30:00Z\"}" -o /dev/null -w "09:00-10:00 → %{http_code}\n"

# 09:30–10:30 — MUST be rejected
curl -s -X POST $API/bookings -H "Authorization: Bearer $RAJ" -H 'Content-Type: application/json' \
  -d "{\"resourceId\":\"$B2\",\"startsAt\":\"${D}T04:00:00Z\",\"endsAt\":\"${D}T05:00:00Z\"}" -w "\n09:30-10:30 → %{http_code}\n" | jq

# 10:00–11:00 — MUST be accepted (half-open range: they touch but do not overlap)
curl -s -X POST $API/bookings -H "Authorization: Bearer $RAJ" -H 'Content-Type: application/json' \
  -d "{\"resourceId\":\"$B2\",\"startsAt\":\"${D}T04:30:00Z\",\"endsAt\":\"${D}T05:30:00Z\"}" -o /dev/null -w "10:00-11:00 → %{http_code}\n"
```

```
09:00-10:00 → 201
09:30-10:30 → 409   BOOKING_OVERLAP  (details.conflicts lists the clash)
10:00-11:00 → 201
```

---

## The rules judges will try to break

### Signup cannot create an admin

```bash
curl -s -X POST $API/auth/signup -H 'Content-Type: application/json' \
  -d '{"organizationSlug":"acme","name":"Mallory","email":"m@acme.test",
       "password":"password123","role":"admin"}' | jq '.user.role'
```

```
"employee"
```

The signup schema has **no `role` field** and the insert never sets one, so the
column's `DEFAULT 'employee'` is the only value that can land. There is no check to
bypass. Roles are assigned in the Employee Directory, by an Admin, and nowhere else.

### Invalid input names the field

```bash
curl -s -X POST $API/auth/signup -H 'Content-Type: application/json' \
  -d '{"organizationSlug":"acme","name":"X","email":"not-an-email","password":"short"}' | jq
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      { "field": "email",    "message": "That doesn't look like a valid email address." },
      { "field": "password", "message": "Password must be at least 8 characters." }
    ]
  }
}
```

The UI renders those messages **under the offending inputs** — the same strings, from
the server. There is no second copy of the rules in the client to drift.

### An employee cannot promote herself

```bash
PRIYA=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"priya@acme.test","password":"password123"}' | jq -r .token)
PRIYA_ID=$(curl -s "$API/users?q=priya" -H "Authorization: Bearer $PRIYA" | jq -r '.[0].id')

curl -s -X PATCH $API/users/$PRIYA_ID -H "Authorization: Bearer $PRIYA" \
  -H 'Content-Type: application/json' -d '{"role":"admin"}' | jq -r '.error.code'
```

```
FORBIDDEN
```

### Work cannot start before maintenance is approved

**In the UI:** *Maintenance* → drag the **Pending** card straight to **In progress**.

```
409  A Pending request cannot move to In Progress.
     It can only go to: Approved, Rejected.
```

The state machine has **no edge** from `pending` to `in_progress`. Illegal moves are
the ones that simply are not in the table — not a check that could be forgotten.

Approving flips the asset to **Under Maintenance**; resolving returns it.

### An upload must really be an image

```bash
printf '#!/bin/sh\nrm -rf /\n' > evil.png       # a script wearing a .png name
curl -s -X POST $API/assets/$LAPTOP/photo -H "Authorization: Bearer $RAJ" \
  -F "file=@evil.png;type=image/png" | jq -r '.error.code'
```

```
UNSUPPORTED_FILE_TYPE
```

Uploads are validated by **magic bytes**, not the declared MIME type — which is
attacker-controlled. SVG is refused outright: it is XML, it can carry `<script>`,
and we serve uploads from our own origin.

---

## The four differentiators

### Real-time — no polling, no refresh

Open the **Dashboard** in one browser window. In another, allocate an asset (or run
the curl above). The KPI numbers and the activity feed **change without a reload**.

The socket carries no data — only `{ "type": "invalidate", "keys": ["assets", "dashboard"] }`.
The client refetches through the normal authenticated API, so real-time cannot leak
anything and no query's shape is reimplemented for the wire.

### Logo → theme

*Sign out → "start a new organization" → upload any logo.*

The palette is extracted **in the browser**, clamped for WCAG contrast, and applied
to the document root **instantly** — the whole app re-skins under your cursor, before
anything is saved.

The clamping is the point. A neon-yellow logo would naively produce white text on a
highlighter; the clamp forces saturation and lightness into a legible range **while
preserving the hue** — the part a company actually recognises as theirs. Verified
against hostile logos:

```bash
cd frontend && bun test src/lib      # 19 tests: neon yellow, lime, cyan, white, black, grey
```

### Asset lifecycle timeline

*Assets → click any asset → Timeline.*

```
registered → allocated to Priya → transfer approved to Vikram → returned (fair) → allocated
```

This is a **query over `activity_logs`** — the table every mutation already writes to.
No timeline table, no timeline writer, nothing that can drift from what happened.

### ⌘K command palette

Press **⌘K / Ctrl-K** anywhere. Search `AF-0114` → *"MacBook Pro 14 — held by Priya
Sharma"*. Search a person, jump to any screen, run any quick action.

Search runs on the **server**; a cache-only palette would claim an asset registered a
second ago in another tab does not exist.

---

## Cron you can watch instead of wait for

Sign in as **Admin** → *Notifications* → **Scheduled jobs** → *"Flag overdue returns"*.

`AF-0021` is 3 days overdue. The job runs, Vikram's bell gets the alert, and it
arrives over the WebSocket — live.

Click it again: **nothing happens**. Every job is idempotent, guarded by a `NOT EXISTS`
in the query that *selects* the work. That matters because `setInterval` re-fires if a
run was slow, and a container restart re-runs everything. A job that spams people
trains them to ignore the bell.

---

## Run the tests

```bash
cd backend  && bun test          # 11 — the constraints, against a real PostgreSQL
cd frontend && bun test src/lib  # 19 — the WCAG theme clamp
cd frontend && node e2e/smoke.mjs # 11 — drives real Chromium against the real API
```

> `e2e/smoke.mjs` must run under **Node**, not Bun — Playwright's pipe transport
> fails on Bun/Windows with an opaque launch timeout.

## Read the API

Swagger UI, generated from the same Zod schemas the routes validate against — so the
docs cannot drift from the implementation:

**http://localhost:4000/api/docs**
