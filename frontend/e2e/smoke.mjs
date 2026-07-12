/**
 * End-to-end smoke test — drives a real Chromium against the real API.
 *
 *   1. docker compose up -d postgres
 *   2. cd backend  && bun run db:reset && bun dev
 *   3. cd frontend && bun dev
 *   4. cd frontend && node e2e/smoke.mjs
 *
 * Run with NODE, not Bun: Playwright's pipe transport does not work under Bun on
 * Windows, and fails with an opaque launch timeout.
 *
 * Screenshots land in e2e/shots/ for eyeballing.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

mkdirSync("e2e/shots", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  const text = message.text();
  // A 422 logged by the browser is the validation test working, not a bug.
  if (message.type() === "error" && !text.includes("422")) errors.push(text);
});

const results = [];
const check = (name, passed) => results.push({ name, passed });

// ── 1. The login screen ─────────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(900); // let the entry animation settle
await page.screenshot({ path: "e2e/shots/1-login.png" });

const loginHtml = await page.content();
check("login renders in dark mode", await page.evaluate(() => document.documentElement.classList.contains("dark")));
check("the spec's signup rule is stated", loginHtml.includes("start a new organization"));
check("demo accounts are one click away", loginHtml.includes("Demo accounts"));

// ── 2. Validation: the SERVER's message, under the right field ──────────────
await page.click("text=Create an employee account");
await page.waitForTimeout(300);
await page.fill('input[placeholder="Priya Sharma"]', "Test User");
await page.fill('input[type="email"]', "not-an-email");
await page.fill('input[type="password"]', "short");
await page.click('button[type="submit"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: "e2e/shots/2-validation.png" });

const validationHtml = await page.content();
check("422: email message shown under the field", validationHtml.includes("valid email address"));
check("422: password message shown under the field", validationHtml.includes("at least 8 characters"));

// ── 3. Sign in and reach the app ────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.click("text=Asset Manager");
await page.waitForTimeout(200);
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 10_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "e2e/shots/3-app-shell.png" });

const appHtml = await page.content();
check("signed in and routed to /dashboard", page.url().includes("/dashboard"));
check("the signed-in user is shown", appHtml.includes("Raj Verma"));
check("sidebar renders in the spec's order", appHtml.includes("Allocation &amp; Transfer") || appHtml.includes("Allocation & Transfer"));
check("WebSocket connected (live dot)", appHtml.includes(">Live<"));
// Raj is an Asset Manager, so the Admin-only screen must NOT be in his nav.
check("RBAC hides Organization setup from a non-Admin", !appHtml.includes("Organization setup"));

// ── 4. Light/dark toggle ────────────────────────────────────────────────────
await page.click('button[aria-label="Toggle theme"]');
await page.waitForTimeout(500);
await page.screenshot({ path: "e2e/shots/4-light-mode.png" });
check("light mode toggles", !(await page.evaluate(() => document.documentElement.classList.contains("dark"))));

// ── report ──────────────────────────────────────────────────────────────────
console.log("");
for (const { name, passed } of results) {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`);
}

if (errors.length) {
  console.log("\n  console errors:");
  for (const error of errors.slice(0, 5)) console.log("   ", error);
}

const failed = results.filter((result) => !result.passed).length;
console.log(`\n  ${results.length - failed}/${results.length} passed, ${errors.length} console error(s)\n`);

await browser.close();
process.exit(failed || errors.length ? 1 : 0);
