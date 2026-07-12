"use client";

import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Tone = "brand" | "info" | "warning" | "success" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  brand: "text-brand-400 bg-brand-500/10",
  info: "text-info bg-info/10",
  warning: "text-warning bg-warning/10",
  success: "text-success bg-success/10",
  danger: "text-danger bg-danger/10",
  neutral: "text-muted bg-surface-3",
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  onClick,
  index = 0,
  isLoading,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
  onClick?: () => void;
  index?: number;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="card p-4">
        <div className="skeleton h-3 w-20 mb-3" />
        <div className="skeleton h-8 w-14" />
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // Staggered, so six cards arrive as a wave rather than a flash.
      transition={{ delay: index * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "card p-4 text-left group",
        onClick &&
          "cursor-pointer hover:border-line-strong hover:-translate-y-0.5 transition-all duration-200",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/*
           * The label WRAPS rather than truncating. Six cards across is a tight
           * column, and "Maintenance Tod…" is worse than useless — a KPI whose
           * name you cannot read is not a KPI. min-h keeps the numbers aligned
           * across cards whether the label runs to one line or two.
           */}
          <p className="min-h-8 text-xs leading-4 font-medium text-muted">{label}</p>

          {/* nums = tabular numerals: 9 → 10 must not shift the card's width. */}
          <p className="nums mt-1 text-2xl font-semibold tracking-tight text-fg">{value}</p>

          {hint && <p className="mt-0.5 text-[11px] leading-tight text-subtle">{hint}</p>}
        </div>

        <div
          className={cn(
            "rounded-lg p-2 shrink-0 transition-transform duration-200",
            onClick && "group-hover:scale-110",
            TONES[tone],
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </motion.button>
  );
}
