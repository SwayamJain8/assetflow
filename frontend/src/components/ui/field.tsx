"use client";

import { AlertCircle } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * FormField renders the backend's own validation message under the offending
 * input.
 *
 * The backend answers a bad request with:
 *
 *   422 { error: { code: "VALIDATION_ERROR", details: [
 *          { field: "email", message: "That doesn't look like a valid email address." }
 *        ]}}
 *
 * ApiError.fieldErrors turns that array into { email: "..." }, and a form passes
 * it straight here. So the message the user reads is the one the SERVER decided —
 * there is no second copy of the rules living in the client to drift out of sync,
 * and a rule that only the database knows (a duplicate email, an overlapping
 * booking) surfaces in exactly the same place as a simple format check.
 */

const baseInput = cn(
  "w-full rounded-lg bg-surface-2 border px-3 text-sm text-fg",
  "placeholder:text-subtle transition-colors",
  "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
  "disabled:opacity-60 disabled:cursor-not-allowed",
);

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label className="block text-xs font-medium text-muted">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}

      {children}

      {error ? (
        <p className="flex items-start gap-1.5 text-xs text-danger animate-fade-up">
          <AlertCircle className="size-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid}
      className={cn(
        baseInput,
        "h-9.5",
        invalid ? "border-danger focus:border-danger focus:ring-danger/20" : "border-line",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid}
      className={cn(
        baseInput,
        "py-2 min-h-20 resize-y",
        invalid ? "border-danger focus:border-danger focus:ring-danger/20" : "border-line",
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid}
      className={cn(
        baseInput,
        "h-9.5 cursor-pointer appearance-none",
        // A native select has no arrow once appearance is stripped; draw one.
        "bg-[image:var(--chevron)] bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9",
        invalid ? "border-danger" : "border-line",
        className,
      )}
      style={{
        // Inline so it can reference the current text colour in both themes.
        ["--chevron" as string]:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7383' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
});
