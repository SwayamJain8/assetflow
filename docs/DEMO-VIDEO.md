# AssetFlow — The Demo Video

**One document. Follow it top to bottom while you record.**

Target: **9–10 minutes**. Roughly 60% explaining *why*, 40% showing *what*.
Tone: calm, like a senior engineer explaining a decision to a colleague. Not a
salesperson. Slower than feels natural.

Each scene tells you three things:

> 👤 **WHO** — which account to be signed in as
> 🎬 **DO** — what to click and point at
> 🎤 **SAY** — what to speak, in plain English

---

# BEFORE YOU RECORD

```bash
docker compose down -v
docker compose up -d
docker compose exec api bun run db:seed
```

The seed prints a summary. You should see: **22 people · 54 assets · 10 departments ·
64 bookings · 31 maintenance requests · 2 audit cycles.** That is a company, not a
test fixture.

Then check all of this:

- [ ] http://localhost:3000/login loads
- [ ] http://localhost:4000/api/docs loads (Swagger)
- [ ] **Two browser windows** side by side — you need this for the real-time scene
- [ ] A **terminal** open, font 18pt+
- [ ] A **colourful logo image** on your desktop, ready to drag in
- [ ] `docs/database-schema.md` open in a tab
- [ ] Browser zoom **110–125%**, dark mode ON
- [ ] Every other tab, notification and Slack **closed**

Every account's password is **`password123`**. The login screen has one-click chips
for all four roles — use them, don't type.

| Chip | Who | Why you'll switch to them |
|---|---|---|
| **Admin** | `admin@acme.test` | Organization setup, audit, cron jobs |
| **Asset Manager** | `raj@acme.test` | Register, allocate, approve |
| **Department Head** | `aditi@acme.test` | Approve transfers |
| **Employee** | `priya@acme.test` | **Holds AF-0114** — the star of scenario 1 |

**⚠️ Two things the seed protects. Don't break them before recording:**
- **AF-0114** is held by Priya. Don't return it.
- **Room B2** is booked **09:00–10:00** today, and **10:00–11:00 is deliberately
  free**. Don't book it — that's the slot you book *on camera*.

---

# THE ONE LINE I CHANGED

You wanted to say *"it's deployment-ready, I just ran out of time to deploy it."*

**Don't.** It isn't what happened, and it's the most forgettable sentence in any
hackathon demo. You made a **deliberate call** not to deploy, and the reasoning is
genuinely good. Say that instead — it's true, and it makes you sound like an engineer
rather than someone apologising:

> *"It's fully containerized, so it runs identically anywhere Docker runs — it's
> deployment-ready as it stands. I demoed it locally on purpose: the brief asks for a
> local database and no backend-as-a-service, and a split deploy — an HTTPS frontend
> calling a plain-HTTP backend — is blocked by the browser as mixed content anyway.
> So the correct answer was one `docker compose up`."*

That's already written into Scene 10.

---

# SCENE 1 — Cold open · the two lines of SQL
### ⏱ 0:00 – 0:40

> Don't open with "Hi, my name is…". Judges have watched thirty of those. **Open on
> the problem.** Introduce yourself at 0:35, once they already want to listen.

👤 **WHO** — nobody. Just a code editor.

🎬 **DO** — Show only this, big font. (Scroll to it in `docs/database-schema.md`.)

```sql
CREATE UNIQUE INDEX one_active_allocation
  ON allocations (asset_id) WHERE (returned_at IS NULL);

ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (resource_id WITH =, during WITH &&)
  WHERE (status <> 'cancelled');
```

🎤 **SAY**

> "An asset cannot be held by two people at the same time. Two bookings for the same
> room cannot overlap.
>
> Those are the two hardest rules in this problem statement — and almost everyone
> solves them the same way. They write code that checks first: *is this laptop free?*
> — and then inserts.
>
> That check is a **race condition**. If two requests arrive at the same moment, both
> of them look, both see a free laptop, both write. Now it's assigned to two people.
> No amount of JavaScript closes that gap, because the gap is *between* the read and
> the write.
>
> So AssetFlow doesn't check. It **attempts the write, and lets PostgreSQL refuse
> it.**
>
> These two lines are the centre of the whole project. The database decides — the
> application just explains.
>
> I'm Swayam. This is AssetFlow. Let me show you what that idea buys you."

---

# SCENE 2 — The 30-second tour · prove it's all real
### ⏱ 0:40 – 1:20

👤 **WHO** — sign in with the **Admin** chip.

🎬 **DO** — Land on the Dashboard. Then click **fast** down the sidebar — about 4
seconds each, no stopping: Organization → Assets → Allocation → Booking →
Maintenance → Audit → Reports → Notifications.

🎤 **SAY**

> "Very quickly, so you know it's all here: a KPI dashboard. Organization setup —
> departments, categories, the employee directory. The asset register. Allocation and
> transfer. Resource booking on a live time grid. Maintenance as a Kanban board.
> Audit cycles. Reports. And a notification feed.
>
> Fifty-four assets, twenty-two people, ten departments. Every number you just saw
> came out of PostgreSQL — there's no mock data and no static JSON anywhere in this.
>
> And there's no backend-as-a-service. No Firebase, no Supabase. It's my own schema,
> my own API, my own Postgres, in Docker, on this machine.
>
> Now let me go back and prove the parts that are actually hard."

---

# SCENE 3 ⭐⭐ — Scenario 1 · the double-allocation block
### ⏱ 1:20 – 2:50 — **the most important 90 seconds of the video. Slow down.**

👤 **WHO** — sign out, sign in as **Raj** (Asset Manager chip).

🎬 **DO** — Go to **Allocation & Transfer**. Search **`AF-0114`**. The **red block**
appears. Let it sit for a second before you speak over it.

🎤 **SAY**

> "The spec names this exact case. Priya is holding laptop AF-0114. Raj — an asset
> manager — tries to give it to somebody else.
>
> Blocked. And it tells him *who* has it: Priya Sharma, Engineering. Instead of a dead
> end, it offers him the correct path — raise a transfer request."

🎬 **DO** — Now click **"Attempt it anyway → see the database refuse it."** The real
409 prints on screen. **Pause on it for two full seconds.**

🎤 **SAY**

> "But a greyed-out button hasn't *prevented* anything. Anyone can skip my UI and hit
> the API directly with curl. So I put a button here that fires the **real request**
> and shows you the database's own answer.
>
> Four-oh-nine. Asset already allocated.
>
> And here's the part I want to be precise about. There is **no 'is it free?' check**
> in front of that insert. The service just tries it. What refused it is that partial
> unique index — *unique on asset ID, but only where returned_at is null.*
>
> Which means an asset can have a hundred **past** allocations in its history, but
> only ever **one open** one. The history survives, and the rule becomes physically
> unbreakable — even if a hundred requests arrive in the same millisecond."

🎬 **DO** — Submit a **Transfer Request** (Raj → someone). Then sign in as **Aditi**
(Department Head) and **approve** it. Show the asset move to its new holder.

🎤 **SAY**

> "And the workflow completes properly: requested, approved by a department head,
> re-allocated — and the allocation history updates itself.
>
> Because closing the old allocation is exactly what frees the index for the new one.
> The rule and the workflow are the same mechanism."

---

# SCENE 4 ⭐⭐ — Scenario 2 · the booking overlap
### ⏱ 2:50 – 4:05

👤 **WHO** — sign in as **Priya** (Employee chip).

🎬 **DO** — **Resource Booking** → pick **Room B2**. The 09:00–10:00 block is on the
grid.

🎤 **SAY**

> "Second rule. Room B2 is booked from nine to ten. The spec says a request for
> nine-thirty to ten-thirty must be **rejected**, and ten to eleven must be
> **accepted**."

🎬 **DO** — Click a free slot → enter **09:30 – 10:30** → submit. **The clashing rows
flash red.**

🎤 **SAY**

> "Nine-thirty to ten-thirty — refused. And it paints the exact slot it clashes with
> in red.
>
> That's not my code checking. That's a PostgreSQL **exclusion constraint**, using the
> btree_gist extension. In plain English it says: *for any two rows in this table — if
> the room is the same **and** the time ranges overlap, reject it.* The database
> enforces that on the way in."

🎬 **DO** — Now book **10:00 – 11:00**. **It succeeds.**

🎤 **SAY**

> "Ten to eleven — accepted.
>
> And *that* is the detail I'm proudest of. Look at why it's allowed. The time range
> is stored as a **half-open interval** — square bracket, round bracket. Nine-to-ten
> *includes* nine o'clock, and *excludes* ten. So ten o'clock is genuinely free. The
> two bookings touch, but they do not overlap.
>
> If I'd stored a normal closed range, ten-to-eleven would have been wrongly rejected
> — and that's an off-by-one bug you would only ever find in production, when a user
> can't book the meeting room right after yours."

🎬 **DO** — Flash the generated column in the migration or schema doc:

```sql
ALTER TABLE bookings ADD COLUMN during tstzrange
  GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED;
```

🎤 **SAY**

> "And the range is a **generated column** — the application never writes it. It can't
> drift from the start and end times, because Postgres computes it. And the same
> constraint guards **rescheduling** too — you can't drag a booking on top of another
> one either."

---

# SCENE 5 — The schema · the criterion they said matters most
### ⏱ 4:05 – 5:05

👤 **WHO** — no login. Docs + terminal.

🎬 **DO** — Open `docs/database-schema.md`, scroll the **ER diagram** slowly. Then in
a terminal:

```bash
docker compose exec postgres psql -U assetflow -d assetflow -c "\d bookings"
```

Let the real constraint print.

🎤 **SAY**

> "The brief said database design is the most important criterion — so I designed the
> schema first, and built everything else on top of it.
>
> Fourteen tables. Eleven **native Postgres enums**, not strings I check somewhere in
> code. Foreign keys with deliberate on-delete behaviour. Indexes on every lookup
> column.
>
> Departments are **self-referential** — a parent department ID — so Platform sits
> inside Engineering, and the hierarchy can nest as deep as a real company needs.
>
> And every core table carries an `organization_id`. This is **multi-tenant from day
> one** — because retrofitting tenancy into a live schema is one of the most painful
> migrations there is, and adding it up front cost me almost nothing.
>
> And that's the real constraint, printed by Postgres itself, out of the running
> container. It's not on a slide. It's in the database."

🎬 **DO** — Point at **`activity_logs`** in the diagram.

🎤 **SAY**

> "And one table earns its keep three times. Every single action in the system writes
> one row to `activity_logs`. That one table becomes the audit trail, the notification
> feed, **and** the asset lifecycle timeline. Three features, one write."

---

# SCENE 6 — Validation & security · the rules judges will try to break
### ⏱ 5:05 – 6:05

👤 **WHO** — sign out. Switch the login card to **Sign up**.

🎬 **DO** — Type `not-an-email` and a 3-character password. Submit. The errors appear
**under the fields**.

🎤 **SAY**

> "Validation. Invalid email — the message appears under the field, in plain language.
>
> But the important part is *where that sentence came from*. The **server** wrote it,
> not the browser. The API returns errors in exactly one shape — a code, a message,
> and a list of which fields are wrong — and one form component drops each message
> under the input it belongs to.
>
> So the client never re-implements a validation rule, which means the two can never
> drift apart. And it works for rules only the *database* knows — a duplicate email,
> or that booking overlap you just saw, render the same way, in the same place."

🎬 **DO** — Terminal. Try to sign up **as an admin**:

```bash
curl -s -X POST http://localhost:4000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"organizationSlug":"acme","name":"Mallory","email":"m@acme.test",
       "password":"password123","role":"admin"}'
```

It comes back **`"role": "employee"`**.

🎤 **SAY**

> "The spec says signup can only ever create an Employee — roles are handed out by an
> Admin and nowhere else. So here I am, at signup, asking to be an admin.
>
> I get back: employee.
>
> And notice *how*. I didn't write a check that strips the field. The signup schema
> simply **has no role field**, and the insert never sets one — so the column's
> database default, 'employee', is the only value that can possibly land.
>
> There's no check to bypass, because there's no check. **The safest code is the code
> that doesn't exist.**"

🎬 **DO** *(optional — 15 seconds, but a strong 15)* — Rename a shell script to
`evil.png` and upload it. It's refused with `UNSUPPORTED_FILE_TYPE`.

🎤 **SAY**

> "One more. Uploads are validated by reading the file's **magic bytes** — the actual
> first bytes of the file — not the file type the client *claims*, because the client
> is the attacker. A shell script renamed .png is refused. And SVG is rejected
> outright: it's XML, it can carry a script tag, and we serve uploads from our own
> origin."

---

# SCENE 7 — The four differentiators
### ⏱ 6:05 – 7:30 — pace picks up. ~20 seconds each. Don't linger.

## 7a · Real-time — do this **live**, it's the best visual you have

👤 **WHO** — **two windows.** Left: **Priya** on the Dashboard. Right: **Raj**.

🎬 **DO** — In the right window, allocate an asset or approve a maintenance card.
**Watch the left window change on its own** — KPI numbers, activity feed, the bell.
No refresh.

🎤 **SAY**

> "Real-time. I'm touching nothing on the left. Watch it.
>
> That's a Bun-native WebSocket. But here's the design decision I care about: **the
> socket carries no data.** It sends one message — *these queries are stale.* The
> client then refetches through the normal authenticated API.
>
> Which means real-time **cannot leak anything** — it goes through the same permission
> checks as every other request — and I never had to rewrite a single query for the
> wire. Every screen in the app became live for free."

## 7b · Logo → theme — the one they'll remember

👤 **WHO** — sign out → **"start a new organization."**

🎬 **DO** — Fill the form, then **drag in your colourful logo**. The whole app
re-skins instantly. Point at the **six colour swatches** and the **contrast number**.

🎤 **SAY**

> "Onboarding. Upload the company's logo — and the whole app re-skins to their brand.
> Live, before anything is even saved.
>
> Pulling colours out of an image is the easy part. The hard part is that a lot of
> logos are terrible as interface colours. A neon-yellow logo would naively give you
> white text on a highlighter — unreadable.
>
> So the colour gets **clamped**: forced into a range that stays legible, and checked
> against the WCAG contrast standard — while the **hue is preserved**, because the hue
> is the part a company actually recognises as theirs.
>
> See that line — 'contrast of white text on your brand, clamped to stay readable.'
> The app is showing its work. There are 19 tests for this, against deliberately
> horrible logos: neon yellow, pure white, pure black. It is not possible to produce
> an unreadable button."

## 7c · Asset lifecycle timeline

🎬 **DO** — **Assets** → click **AF-0114** → the drawer opens → **Timeline** tab.
(This asset has a full story: registered → allocated to Arjun → maintenance →
returned → transferred → allocated to Priya.)

🎤 **SAY**

> "Every asset carries its whole life. This laptop was registered, given to Arjun, sent
> for a keyboard repair, returned, transferred, and given to Priya.
>
> And this is that `activity_logs` table paying off. There's **no timeline table** and
> no code that writes a timeline — it's a query over the rows every action already
> wrote. So it **cannot drift** from what actually happened."

## 7d · ⌘K command palette

🎬 **DO** — Press **Ctrl-K**. Type `AF-0114` — it finds the laptop *and shows who
holds it*. Jump to it. Ctrl-K again → jump to a screen.

🎤 **SAY**

> "And a command palette. Any asset, any person, any screen, any action — from
> anywhere.
>
> The search runs on the **server**, not over cached data — because a palette that only
> searches the local cache will confidently tell you that an asset someone registered
> ten seconds ago in another tab doesn't exist."

---

# SCENE 8 — Cron you can watch, instead of wait for
### ⏱ 7:30 – 8:00

👤 **WHO** — **Admin**.

🎬 **DO** — **Notifications** → right rail → **Scheduled jobs** → click **"Flag
overdue returns."** The alert arrives live. **Now click it a second time — nothing
happens.**

🎤 **SAY**

> "Four scheduled jobs run in the background — overdue returns, booking reminders,
> ageing assets, stale audits. Rather than make you wait a day for a schedule, I gave
> the admin a button to run one now.
>
> It found the two overdue laptops, and the alert arrived over the WebSocket — live.
>
> Now watch me click it again. **Nothing happens.**
>
> Every job is **idempotent** — guarded inside the query that selects the work. That
> matters, because a timer re-fires if a run was slow, and restarting a container
> re-runs everything. A system that pings people twice a day teaches them to ignore
> the bell — and then your alerting is worth nothing."

---

# SCENE 9 — Tests, architecture, Swagger
### ⏱ 8:00 – 8:40

🎬 **DO** — Terminal:

```bash
cd backend && bun test
```

`11 pass, 0 fail`. Then show the folder structure, then
**http://localhost:4000/api/docs**.

🎤 **SAY**

> "Tests. Eleven backend tests, and they run against a **real PostgreSQL**, not a mock
> — because a mocked database would prove nothing here. The guarantees *live* in the
> database. Plus nineteen tests on the theme clamp, and eleven end-to-end tests driving
> a real browser against the real API.
>
> Architecture: one folder per domain — schema, service, routes. All the business rules
> live in the **services**. A route handler is about five lines: read the user, call the
> service, return JSON.
>
> And the API documentation is **generated from the same Zod schemas the routes
> actually validate against** — so the docs physically cannot drift from the code.
> Around fifty-five endpoints, all documented, for free."

---

# SCENE 10 — Deployment · say it the honest way
### ⏱ 8:40 – 9:00

🎬 **DO** — Show `docker-compose.yml`, and `docker compose ps` with all three
containers healthy.

🎤 **SAY**

> "The whole thing is one command — `docker compose up`. Postgres, the API, and the
> UI. The API even runs its own migrations on boot.
>
> It's fully containerized, so it runs identically anywhere Docker runs — it is
> **deployment-ready as it stands**. I demoed it locally on purpose: the brief asks for
> a **local database and no backend-as-a-service**, and a split deploy — an HTTPS
> frontend calling a plain-HTTP backend — gets blocked by the browser as mixed content
> anyway.
>
> So the honest, correct answer was one `docker compose up`."

---

# SCENE 11 — Close · land the plane
### ⏱ 9:00 – 9:40 — **add nothing new here.**

🎬 **DO** — Back to the Dashboard. Let it sit.

🎤 **SAY**

> "So — to close where I started.
>
> The brief said this wasn't about coding fast; it was about thinking carefully and
> designing well. So I made one decision early, and let everything else follow from
> it: **put the hard rules in the database, and let the application explain them.**
>
> That single choice is why an asset can't be double-allocated even under a race. It's
> why two meetings can't overlap, but back-to-back meetings still work. It's why the
> lifecycle timeline can't lie about what happened. And it's why I didn't need
> defensive checks scattered all over the codebase — because the guarantee lives in
> one place, and it's the one place that can actually enforce it.
>
> Everything's here: ten screens, real data, real validation, real-time, role-based
> access, scheduled jobs, tests, and generated API docs. No backend-as-a-service, no
> shortcuts.
>
> Just Postgres, doing what Postgres is good at. Thank you."

---
---

# APPENDIX A — Every screen, in depth
### Use this if a judge asks about a screen, or if you want to widen Scene 2.

## Login
Four one-click role chips. **The point:** signing up always creates an **Employee** —
never an admin. Roles are handed out by an Admin, in one place. Forgot-password opens
a dialog telling you an Admin resets it: there's no email link, on purpose — a reset
link is a second, unguarded door into an account.

## Onboarding
Two steps: create the org, then upload a logo and watch the app re-skin. The palette
is extracted **in the browser**, **clamped for WCAG contrast**, and stored on the
Organization row as JSON — so theming is a real, database-backed feature, not a CSS
trick.

## Dashboard
**Six KPI cards** — Assets Available, Allocated, Maintenance Today, Active Bookings,
Pending Transfers, Upcoming Returns — and every one is a **link** to the filtered
list. A **red overdue banner** nobody typed in: a cron job raised it. An **estate bar**
showing where every asset sits. All of it from **one API call**, and all of it live
over the WebSocket.

## Organization Setup *(Admin only)*
Three tabs.
- **Departments** — note the **Parent Dept** column. Platform and QA sit inside
  Engineering. That's the self-referential foreign key: a table pointing at itself.
- **Categories** — each carries its **own custom fields**. Electronics needs a warranty
  and a supplier; a Room needs a seat count; a Vehicle needs a registration number. So
  instead of guessing every column a company might ever want, a category defines its
  own — and the asset form grows those fields automatically.
- **Employee** — the Role dropdown here is **the only control in the entire product**
  that can change a role. And the API refuses to remove the last active Admin, or to
  deactivate anyone still holding assets — either would lock the company out of its own
  system.

## Assets
54 assets, 6 categories, all **7 lifecycle states** (Available, Allocated, Reserved,
Under Maintenance, Lost, Retired, Disposed) — a native Postgres enum, so an invalid
status can't be saved. Search by tag, serial, or QR (a barcode scanner just types the
tag into the box). Registering an asset, you **cannot choose the tag** — AF-0114 is
minted by a Postgres sequence, so two simultaneous registrations can't collide. Click
any row for the drawer, and its **lifecycle timeline**.

## Allocation & Transfer ⭐
Scene 3. The red block, the real 409, the transfer workflow. Right rail shows **pending
transfers** and **overdue returns**.

## Resource Booking ⭐
Scene 4. Time grid, 08:00–20:00 in half-hour rows. Overlaps refused by the database and
painted red; back-to-back allowed. Click your own booking to **reschedule** — the same
constraint guards the update.

## Maintenance (Kanban)
Five columns: **Pending → Approved → Technician assigned → In progress → Resolved**,
plus Rejected off the board. **Anyone** can raise a request (with a photo); only a
manager can move a card. **Approving flips the asset to Under Maintenance; resolving
brings it back** — the board and the register stay in step by themselves.
**Try dragging Pending straight to In progress: it's refused.** There is simply **no
path** in the state machine from Pending to In Progress. Work does not begin before
approval — and an illegal move isn't blocked by a check I remembered to write, it just
isn't in the map.

## Audit
An Admin opens a cycle, scopes it to a department or a location, and assigns **one or
more auditors** — a genuine many-to-many table, because the spec said "one or more".
Auditors mark each asset **Verified / Missing / Damaged**, and the **discrepancy report
writes itself**. Closing the cycle does two things: assets confirmed missing become
**Lost** — the audit updates the register — and the cycle **locks forever**. An audit is
evidence; if you can quietly rewrite it afterwards, it was never evidence.
*(The seeded closed Q2 cycle is exactly how AF-0009 became "lost".)*

## Reports
Six views: **utilization by department** (what share of a team's assets are actually in
someone's hands), **maintenance frequency** over 12 months (if one asset type keeps
breaking, that's a buying decision), **most used** and **idle** assets, a **booking
heatmap**, and **assets due for maintenance or nearing retirement**. All exportable to
CSV. The charts read the **brand colour from CSS variables** — so they re-skin with the
logo too.

## Notifications
Filter tabs — **All / Alerts / Approvals / Bookings** — plus the org-wide **activity
log**, which is the same table that draws each asset's timeline. And the **Scheduled
jobs** panel from Scene 8.

---

# APPENDIX B — Five phrases that make you sound senior

Memorise these. Drop them naturally.

1. **"The database decides. The application explains."** ← your thesis. Say it twice.
2. **"A SELECT-then-INSERT check is a race condition."**
3. **"The safest code is the code that doesn't exist."** *(signup has no role field)*
4. **"It cannot drift."** *(the timeline, the API docs, the validation messages)*
5. **"That's an off-by-one you'd only find in production."** *(the half-open interval)*

---

# APPENDIX C — If you're running long, cut in this order

1. The magic-bytes upload demo (Scene 6)
2. The transfer approval (Scene 3) — the *block* is the point, not the approval
3. The `psql` terminal print (Scene 5) — the ER diagram alone is enough
4. Reports, in the Scene 2 tour

**Never cut:** Scene 3, Scene 4, or the real-time moment in 7a.

---

# APPENDIX D — Mistakes that ruin hackathon demos

- **Don't read this in a monotone.** Know the beats; speak like a person. Pausing is
  fine.
- **Don't apologise.** No "sorry, this is a bit slow", no "I didn't get time to…".
  If something isn't there, don't mention it.
- **Don't rush Scenes 3 and 4.** They are what you are being judged on.
- **If something breaks live:** say *"one moment"*, fix it or move on. Judges forgive a
  glitch. They don't forgive five minutes of flailing.
- **Do one full dry run, out loud, with a timer.** You'll find your rough edges there
  and nowhere else.
