"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Overlays are PORTALLED to <body>, not rendered in place.
 *
 * This is not a stylistic preference. A CSS `transform` on any ancestor makes that
 * ancestor the containing block for `position: fixed` descendants — so a fixed
 * inset-0 overlay stops meaning "the viewport" and starts meaning "that div".
 * PageShell's content wrapper animates in with a translateY, which is exactly such
 * a transform, and it was silently trapping this panel inside the content column:
 * measured 187px tall instead of 900, with the footer floating up mid-screen.
 *
 * A portal escapes the transform entirely, and keeps working no matter what
 * animation someone adds to a parent later.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  // Escape closes, and the page behind must not scroll while a modal is open.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

  // Portals need the DOM, which does not exist during the server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "card relative w-full max-h-[88vh] flex flex-col overflow-hidden",
              widths[size],
            )}
          >
            <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-fg truncate">{title}</h2>
                {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
              </div>

              <button
                onClick={onClose}
                aria-label="Close"
                className="text-subtle hover:text-fg transition-colors rounded-md p-1 -m-1 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>

            {footer && (
              <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-line bg-surface-2">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
