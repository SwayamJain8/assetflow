import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes so a later class actually wins over an earlier one. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** "under_maintenance" → "Under Maintenance" */
export const humanize = (value: string) =>
  value
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Times arrive from the API as ISO instants. The BROWSER formats them, because
 * only the browser knows the viewer's timezone — the server deliberately never
 * guesses (see backend/src/utils/time.ts).
 */
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const formatDateTime = (iso: string) =>
  `${new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}, ${formatTime(iso)}`;

/** "2m ago", "3h ago", "2d ago" — the notification feed's timestamps. */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;

  return formatDate(iso);
}

/** ₹1,85,000 — acquisition cost, for ranking and reports only. */
export const formatCurrency = (value: string | number | null) =>
  value === null || value === ""
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(Number(value));

/** A <input type="datetime-local"> value, in LOCAL time, from a Date. */
export function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Client-side CSV export — no server round-trip, no extra dependency.
 * Values are quoted and inner quotes doubled, so a description containing a comma
 * cannot shift every subsequent column.
 */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  asset_manager: "Asset Manager",
  department_head: "Department Head",
  employee: "Employee",
};
