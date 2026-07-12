"use client";

import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  CalendarPlus,
  ClipboardCheck,
  LayoutDashboard,
  Moon,
  Plus,
  Search,
  Sun,
  User,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/context/auth";
import { useTheme } from "@/context/theme";
import { get } from "@/lib/api";
import { cn, humanize, ROLE_LABEL } from "@/lib/utils";

type Results = {
  assets: {
    id: string;
    assetTag: string;
    name: string;
    status: string;
    holderName: string | null;
    isBookable: boolean;
  }[];
  people: { id: string; name: string; email: string; role: string; assetsHeld: number }[];
};

const NAVIGATE = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/assets", label: "Assets", icon: Boxes },
  { href: "/allocation", label: "Allocation & Transfer", icon: ArrowLeftRight },
  { href: "/booking", label: "Resource Booking", icon: CalendarClock },
  { href: "/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/audit", label: "Audit", icon: ClipboardCheck },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/organization", label: "Organization setup", icon: Building2, adminOnly: true },
];

const ACTIONS = [
  { href: "/assets?new=1", label: "Register an asset", icon: Plus },
  { href: "/booking", label: "Book a resource", icon: CalendarPlus },
  { href: "/maintenance?new=1", label: "Raise a maintenance request", icon: Wrench },
];

/**
 * ⌘K — search assets and people, jump anywhere, run the common actions.
 *
 * Search is server-side (one indexed query), not a filter over a client cache: the
 * palette must find the asset you registered a second ago in another tab, and a
 * cache-only search would confidently tell you it does not exist.
 */
export function CommandPalette({ open, onOpen }: { open: boolean; onOpen: (open: boolean) => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { mode, toggle } = useTheme();

  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // The global shortcut. Registered once, at the shell.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpen(!open);
        return;
      }

      // cmdk does NOT close on Escape by itself — the ESC hint in the corner would
      // have been a lie, and a palette you cannot dismiss with Escape is one people
      // reach for the mouse to escape from.
      if (event.key === "Escape" && open) {
        event.preventDefault();
        onOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpen]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", query],
    queryFn: () => get<Results>(`/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.trim().length >= 2,
  });

  const go = (href: string) => {
    onOpen(false);
    setQuery("");
    router.push(href);
  };

  const navigate = NAVIGATE.filter((item) => !item.adminOnly || user?.role === "admin");

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-60 flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={() => onOpen(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="card relative w-full max-w-xl overflow-hidden"
          >
            <Command
              // Filtering is done by the SERVER for search results, so cmdk must not
              // also filter them out client-side.
              shouldFilter={false}
              loop
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase"
            >
              <div className="flex items-center gap-2.5 border-b border-line px-4">
                <Search className="size-4 shrink-0 text-subtle" />

                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search assets and people, or jump to a screen…"
                  className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
                />

                <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-subtle">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-88 overflow-y-auto p-2">
                <Command.Empty className="py-8 text-center text-xs text-subtle">
                  {isFetching ? "Searching…" : query ? `No matches for “${query}”` : null}
                </Command.Empty>

                {/* ── Assets ─────────────────────────────────────────────── */}
                {!!data?.assets.length && (
                  <Command.Group heading="Assets">
                    {data.assets.map((asset) => (
                      <Command.Item
                        key={asset.id}
                        value={`asset-${asset.id}`}
                        onSelect={() =>
                          go(
                            asset.isBookable
                              ? "/booking"
                              : `/allocation?asset=${asset.assetTag}`,
                          )
                        }
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-surface-2"
                      >
                        <Boxes className="size-3.5 shrink-0 text-subtle" />

                        <span className="nums shrink-0 font-mono text-[11px] text-primary">
                          {asset.assetTag}
                        </span>

                        <span className="min-w-0 flex-1 truncate text-fg">{asset.name}</span>

                        {asset.holderName ? (
                          <span className="shrink-0 text-[11px] text-subtle">
                            held by {asset.holderName}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[11px] text-subtle">
                            {humanize(asset.status)}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* ── People ─────────────────────────────────────────────── */}
                {!!data?.people.length && (
                  <Command.Group heading="People">
                    {data.people.map((person) => (
                      <Command.Item
                        key={person.id}
                        value={`person-${person.id}`}
                        onSelect={() => go("/organization")}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-surface-2"
                      >
                        <User className="size-3.5 shrink-0 text-subtle" />

                        <span className="min-w-0 flex-1 truncate text-fg">{person.name}</span>

                        <span className="shrink-0 text-[11px] text-subtle">
                          {ROLE_LABEL[person.role]}
                          {person.assetsHeld > 0 && ` · holds ${person.assetsHeld}`}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* ── Actions + navigation (always available) ────────────── */}
                {query.length < 2 && (
                  <>
                    <Command.Group heading="Actions">
                      {ACTIONS.map((action) => (
                        <Command.Item
                          key={action.href}
                          value={action.label}
                          onSelect={() => go(action.href)}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg data-[selected=true]:bg-surface-2"
                        >
                          <action.icon className="size-3.5 text-primary" />
                          {action.label}
                        </Command.Item>
                      ))}

                      <Command.Item
                        value="toggle theme"
                        onSelect={() => {
                          toggle();
                          onOpen(false);
                        }}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg data-[selected=true]:bg-surface-2"
                      >
                        {mode === "dark" ? (
                          <Sun className="size-3.5 text-primary" />
                        ) : (
                          <Moon className="size-3.5 text-primary" />
                        )}
                        Switch to {mode === "dark" ? "light" : "dark"} mode
                      </Command.Item>
                    </Command.Group>

                    <Command.Group heading="Go to">
                      {navigate.map((item) => (
                        <Command.Item
                          key={item.href}
                          value={item.label}
                          onSelect={() => go(item.href)}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg"
                        >
                          <item.icon className="size-3.5 text-subtle" />
                          {item.label}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  </>
                )}
              </Command.List>

              <footer className="flex items-center justify-between border-t border-line bg-surface-2 px-3 py-2">
                <span className="text-[10px] text-subtle">
                  Search runs on the server — it finds assets registered a second ago.
                </span>

                <span className="flex items-center gap-2 text-[10px] text-subtle">
                  <kbd className={cn("rounded border border-line bg-surface px-1 font-mono")}>↑↓</kbd>
                  navigate
                  <kbd className="rounded border border-line bg-surface px-1 font-mono">↵</kbd>
                  open
                </span>
              </footer>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
