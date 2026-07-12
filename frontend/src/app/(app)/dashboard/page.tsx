"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  PackageCheck,
  Plus,
  Undo2,
  Wrench,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { useAuth } from "@/context/auth";
import { get } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

/**
 * Maps an activity action to the dot colour in the feed, so a glance tells you
 * what kind of thing happened without reading the line.
 */
const ACTION_TONE: Record<string, string> = {
  allocated: "bg-info",
  returned: "bg-success",
  registered: "bg-brand-500",
  booking_confirmed: "bg-info",
  booking_cancelled: "bg-subtle",
  transfer_approved: "bg-success",
  transfer_requested: "bg-warning",
  maintenance_requested: "bg-warning",
  maintenance_approved: "bg-warning",
  maintenance_resolved: "bg-success",
  audit_discrepancy: "bg-danger",
  audit_opened: "bg-brand-500",
  audit_closed: "bg-success",
  role_changed: "bg-danger",
};

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();

  /**
   * The queryKey is "dashboard" — the same string the server sends in its
   * WebSocket invalidation hints. That is the entire wiring for live updates: no
   * polling, no manual refetch. Allocate an asset in another tab and these
   * numbers change here.
   */
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => get<Dashboard>("/dashboard"),
  });

  const kpis = data?.kpis;
  const overdue = data?.overdue ?? [];

  const cards = [
    {
      label: "Assets Available",
      value: kpis?.available ?? 0,
      icon: PackageCheck,
      tone: "success" as const,
      href: "/assets?status=available",
    },
    {
      label: "Assets Allocated",
      value: kpis?.allocated ?? 0,
      icon: Boxes,
      tone: "info" as const,
      href: "/assets?status=allocated",
    },
    {
      label: "Maintenance Today",
      value: kpis?.maintenanceToday ?? 0,
      icon: Wrench,
      tone: "warning" as const,
      hint: `${kpis?.underMaintenance ?? 0} under maintenance`,
      href: "/maintenance",
    },
    {
      label: "Active Bookings",
      value: kpis?.activeBookings ?? 0,
      icon: CalendarClock,
      tone: "brand" as const,
      hint: "happening right now",
      href: "/booking",
    },
    {
      label: "Pending Transfers",
      value: kpis?.pendingTransfers ?? 0,
      icon: ArrowLeftRight,
      tone: "warning" as const,
      href: "/allocation",
    },
    {
      label: "Upcoming Returns",
      value: kpis?.upcomingReturns ?? 0,
      icon: Undo2,
      tone: kpis?.overdueReturns ? ("danger" as const) : ("neutral" as const),
      hint: kpis?.overdueReturns ? `${kpis.overdueReturns} overdue` : "next 7 days",
      href: "/allocation",
    },
  ];

  const firstName = user?.name.split(" ")[0];

  return (
    <PageShell title="Dashboard" subtitle={`Good to see you, ${firstName}`}>
      <div className="space-y-5">
        <section>
          <h2 className="mb-3 text-xs font-medium tracking-wide text-subtle uppercase">
            Today&apos;s Overview
          </h2>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {cards.map((card, index) => (
              <KpiCard
                key={card.label}
                label={card.label}
                value={card.value}
                icon={card.icon}
                tone={card.tone}
                hint={card.hint}
                index={index}
                isLoading={isLoading}
                onClick={() => router.push(card.href)}
              />
            ))}
          </div>
        </section>

        {/*
         * The red banner from the mockup. It only appears when something is
         * actually overdue — a permanent empty warning strip trains people to
         * ignore warnings.
         */}
        {overdue.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-card border border-danger/30 bg-danger-soft p-4"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-danger/15 p-2">
                <AlertTriangle className="size-4 text-danger" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-danger">
                  {overdue.length} asset{overdue.length === 1 ? "" : "s"} overdue for return —
                  flagged for follow-up
                </p>

                <ul className="mt-2 space-y-1">
                  {overdue.slice(0, 3).map((row) => (
                    <li key={row.allocationId} className="nums text-xs text-muted">
                      <span className="font-medium text-fg">{row.assetTag}</span> {row.assetName} —
                      held by {row.holderName ?? "a department"},{" "}
                      <span className="text-danger">
                        {row.daysOverdue} day{row.daysOverdue === 1 ? "" : "s"} overdue
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link href="/allocation">
                <Button size="sm" variant="secondary">
                  Review
                  <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            </div>
          </motion.section>
        )}

        {/* The three quick actions the spec names. */}
        <section className="flex flex-wrap gap-2">
          <Link href="/assets?new=1">
            <Button size="md">
              <Plus className="size-4" />
              Register asset
            </Button>
          </Link>

          <Link href="/booking">
            <Button size="md" variant="secondary">
              <CalendarPlus className="size-4" />
              Book resource
            </Button>
          </Link>

          <Link href="/maintenance?new=1">
            <Button size="md" variant="secondary">
              <Wrench className="size-4" />
              Raise maintenance request
            </Button>
          </Link>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium text-fg">Recent Activity</h2>
              <Link
                href="/notifications"
                className="text-xs text-muted transition-colors hover:text-primary"
              >
                View all
              </Link>
            </header>

            <div className="divide-y divide-line">
              {isLoading &&
                Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3 px-4 py-3">
                    <div className="skeleton size-2 rounded-full" />
                    <div className="skeleton h-3 flex-1" />
                  </div>
                ))}

              {!isLoading && !data?.recentActivity.length && (
                <p className="px-4 py-8 text-center text-xs text-subtle">
                  Nothing has happened yet. Register an asset to get started.
                </p>
              )}

              {data?.recentActivity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                      ACTION_TONE[entry.action] ?? "bg-subtle"
                    }`}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-fg">{entry.summary}</p>
                    {entry.actorName && (
                      <p className="text-[11px] text-subtle">by {entry.actorName}</p>
                    )}
                  </div>

                  <span className="nums shrink-0 text-[11px] text-subtle">
                    {timeAgo(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* The estate at a glance — the 7 lifecycle states as one bar. */}
          <div className="card p-4">
            <h2 className="text-sm font-medium text-fg">Estate</h2>
            <p className="mt-0.5 text-xs text-muted">Where every asset currently sits</p>

            <div className="mt-4 space-y-2.5">
              {[
                { label: "Available", value: kpis?.available ?? 0, colour: "bg-success" },
                { label: "Allocated", value: kpis?.allocated ?? 0, colour: "bg-info" },
                {
                  label: "Under maintenance",
                  value: kpis?.underMaintenance ?? 0,
                  colour: "bg-warning",
                },
              ].map((row) => {
                const total =
                  (kpis?.available ?? 0) + (kpis?.allocated ?? 0) + (kpis?.underMaintenance ?? 0);
                const percent = total ? Math.round((row.value / total) * 100) : 0;

                return (
                  <div key={row.label}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted">{row.label}</span>
                      <span className="nums font-medium text-fg">{row.value}</span>
                    </div>

                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percent}%` }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className={`h-full rounded-full ${row.colour}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 border-t border-line pt-3">
              <div className="flex items-center gap-2 text-xs text-muted">
                <CheckCircle2 className="size-3.5 text-success" />
                <span>Live — this page updates without refreshing</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
