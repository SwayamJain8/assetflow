"use client";

import { cn, humanize } from "@/lib/utils";

/**
 * ONE map from status → colour, used by every screen.
 *
 * Consistency is an explicitly judged criterion, and it is the kind of thing that
 * quietly rots: someone renders "available" green here and blue there, and the
 * product starts to feel unreliable. Centralising the mapping makes that
 * impossible rather than merely discouraged.
 */
const TONES = {
  // Asset lifecycle
  available: "success",
  allocated: "info",
  reserved: "brand",
  under_maintenance: "warning",
  lost: "danger",
  retired: "neutral",
  disposed: "neutral",

  // Condition
  new: "success",
  good: "success",
  fair: "warning",
  poor: "danger",
  damaged: "danger",

  // Maintenance workflow
  pending: "warning",
  approved: "info",
  rejected: "danger",
  technician_assigned: "brand",
  in_progress: "brand",
  resolved: "success",

  // Booking
  upcoming: "info",
  ongoing: "brand",
  completed: "neutral",
  cancelled: "neutral",

  // Transfer
  requested: "warning",
  reallocated: "success",

  // Audit
  verified: "success",
  missing: "danger",

  // Entity status
  active: "success",
  inactive: "neutral",

  // Priority
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
} as const;

type Tone = "success" | "danger" | "warning" | "info" | "brand" | "neutral";

const STYLES: Record<Tone, string> = {
  success: "bg-success-soft text-success border-success/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  info: "bg-info-soft text-info border-info/25",
  brand: "bg-brand-500/12 text-brand-400 border-brand-500/25",
  neutral: "bg-surface-3 text-muted border-line",
};

export function StatusPill({
  status,
  className,
  dot = true,
}: {
  status: string;
  className?: string;
  dot?: boolean;
}) {
  const tone: Tone = (TONES as Record<string, Tone>)[status] ?? "neutral";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-xs font-medium whitespace-nowrap transition-colors",
        STYLES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {humanize(status)}
    </span>
  );
}
