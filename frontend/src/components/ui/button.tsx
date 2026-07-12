"use client";

import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  // `bg-primary` resolves to var(--brand-500) at runtime, so every button in the
  // app re-skins the instant an organization's logo is processed.
  primary:
    "bg-primary text-white hover:bg-primary-hover shadow-sm hover:shadow active:scale-[0.98]",
  secondary:
    "bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong active:scale-[0.98]",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110 active:scale-[0.98]",
  success: "bg-success text-white hover:brightness-110 active:scale-[0.98]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9.5 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
  icon: "h-9 w-9",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap",
        "transition-all duration-150 cursor-pointer",
        "disabled:opacity-50 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});
