"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, History, Play } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/data-table";
import { useCan } from "@/context/auth";
import { ApiError, get, post } from "@/lib/api";
import type { ActivityEntry, Notification } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

const TABS = ["all", "alerts", "approvals", "bookings"] as const;
type Tab = (typeof TABS)[number];

/** The dot colours from the mockup's feed. */
const TYPE_TONE: Record<string, string> = {
  asset_assigned: "bg-info",
  transfer_approved: "bg-success",
  maintenance_approved: "bg-success",
  maintenance_rejected: "bg-danger",
  booking_confirmed: "bg-info",
  booking_cancelled: "bg-subtle",
  booking_reminder: "bg-brand-500",
  overdue_return: "bg-danger",
  audit_discrepancy: "bg-warning",
};

/** The scheduled jobs, exposed so cron can be demonstrated rather than waited for. */
const JOBS = [
  { id: "overdue-returns", label: "Flag overdue returns" },
  { id: "booking-reminders", label: "Send booking reminders" },
  { id: "assets-needing-attention", label: "Flag ageing assets" },
  { id: "overdue-audits", label: "Flag stale audit cycles" },
] as const;

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { isAdmin } = useCan();

  const [tab, setTab] = useState<Tab>("all");
  const [view, setView] = useState<"feed" | "activity">("feed");

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", tab],
    queryFn: () => get<Notification[]>(`/notifications?tab=${tab}`),
  });

  const { data: activity = [] } = useQuery({
    queryKey: ["activity"],
    queryFn: () => get<ActivityEntry[]>("/activity?limit=60"),
    enabled: view === "activity",
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => post(`/notifications/${id}/read`),
    onSuccess: refresh,
  });

  const markAllRead = useMutation({
    mutationFn: () => post<{ markedRead: number }>("/notifications/read-all"),
    onSuccess: (result) => {
      refresh();
      toast.success(`${result.markedRead} notification${result.markedRead === 1 ? "" : "s"} marked read`);
    },
  });

  /**
   * Running a cron job on demand.
   *
   * A job that fires every six hours cannot be shown to anyone. This button runs
   * the real scheduled job — the same function, with the same idempotency guard —
   * and the notification it produces arrives in the bell over the WebSocket, live.
   */
  const runJob = useMutation({
    mutationFn: (name: string) => post<{ job: string; notified: number }>(`/jobs/${name}/run`),
    onSuccess: (result) => {
      refresh();
      toast.success(`${result.job} ran`, {
        description: result.notified
          ? `${result.notified} notification${result.notified === 1 ? "" : "s"} sent — check the bell.`
          : "Nothing to do — the job is idempotent, so re-running it sends nothing.",
      });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const unread = notifications.filter((notification) => !notification.isRead).length;

  return (
    <PageShell
      title="Notifications"
      subtitle="Alerts, approvals, and the activity log"
      actions={
        unread > 0 && (
          <Button size="sm" variant="secondary" onClick={() => markAllRead.mutate()}>
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
        )
      }
    >
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {TABS.map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setTab(item);
                    setView("feed");
                  }}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-all",
                    view === "feed" && tab === item
                      ? item === "alerts"
                        ? "border-danger/40 bg-danger-soft text-danger"
                        : "border-primary/40 bg-primary/12 text-fg"
                      : "border-line bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>

            <button
              onClick={() => setView(view === "feed" ? "activity" : "feed")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                view === "activity"
                  ? "border-primary/40 bg-primary/12 text-fg"
                  : "border-line bg-surface-2 text-muted hover:text-fg",
              )}
            >
              <History className="size-3.5" />
              Activity log
            </button>
          </div>

          {/* ── The feed ────────────────────────────────────────────────── */}
          {view === "feed" ? (
            <div className="card overflow-hidden">
              {isLoading ? (
                <div className="space-y-px">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-3 px-4 py-3">
                      <div className="skeleton size-2 rounded-full" />
                      <div className="skeleton h-4 flex-1" />
                    </div>
                  ))}
                </div>
              ) : !notifications.length ? (
                <EmptyState
                  title={tab === "all" ? "No notifications" : `No ${tab}`}
                  description="You'll be told when an asset is assigned to you, a booking is confirmed, or something is overdue."
                  icon={Bell}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {notifications.map((notification, index) => (
                    <motion.li
                      key={notification.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      onClick={() => !notification.isRead && markRead.mutate(notification.id)}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
                        !notification.isRead && "bg-primary/[0.03]",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          TYPE_TONE[notification.type] ?? "bg-subtle",
                        )}
                      />

                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-xs",
                            notification.isRead ? "text-muted" : "font-medium text-fg",
                          )}
                        >
                          {notification.title}
                        </p>

                        {notification.body && (
                          <p className="mt-0.5 text-[11px] text-subtle">{notification.body}</p>
                        )}

                        {notification.link && (
                          <Link
                            href={notification.link}
                            className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
                          >
                            Open →
                          </Link>
                        )}
                      </div>

                      <span className="nums shrink-0 text-[11px] text-subtle">
                        {timeAgo(notification.createdAt)}
                      </span>

                      {!notification.isRead && (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /* ── The activity log ─────────────────────────────────────── */
            <div className="card overflow-hidden">
              <header className="border-b border-line px-4 py-2.5">
                <p className="text-xs text-muted">
                  Who did what, when — org-wide and immutable. The same table powers each asset&apos;s
                  lifecycle timeline.
                </p>
              </header>

              <ul className="divide-y divide-line">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-subtle" />

                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-fg">{entry.summary}</p>
                      <p className="text-[11px] text-subtle">
                        {entry.actorName ?? "System"} · {entry.entityType}
                      </p>
                    </div>

                    <span className="nums shrink-0 text-[11px] text-subtle">
                      {timeAgo(entry.createdAt)}
                    </span>
                  </li>
                ))}

                {!activity.length && (
                  <EmptyState title="No activity yet" icon={History} />
                )}
              </ul>
            </div>
          )}
        </div>

        {/* ── Cron, made demoable ───────────────────────────────────────── */}
        <aside className="space-y-4">
          {isAdmin && (
            <section className="card p-4">
              <h2 className="text-sm font-medium text-fg">Scheduled jobs</h2>
              <p className="mt-0.5 text-xs text-muted">
                These run on a timer. Run one now and watch its notification arrive in the bell —
                live, over the WebSocket.
              </p>

              <div className="mt-3 space-y-1.5">
                {JOBS.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => runJob.mutate(job.id)}
                    disabled={runJob.isPending}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-xs text-muted transition-colors hover:border-primary/40 hover:text-fg disabled:opacity-50"
                  >
                    <Play className="size-3 text-primary" />
                    {job.label}
                  </button>
                ))}
              </div>

              <p className="mt-3 text-[10px] text-subtle">
                Every job is idempotent — running one twice does not send the same notification
                twice.
              </p>
            </section>
          )}

          <section className="card p-4">
            <h2 className="text-sm font-medium text-fg">Events</h2>
            <ul className="mt-2 space-y-1.5">
              {[
                ["Asset assigned", "bg-info"],
                ["Maintenance approved / rejected", "bg-success"],
                ["Booking confirmed / cancelled / reminder", "bg-brand-500"],
                ["Transfer approved", "bg-success"],
                ["Overdue return", "bg-danger"],
                ["Audit discrepancy flagged", "bg-warning"],
              ].map(([label, tone]) => (
                <li key={label} className="flex items-center gap-2 text-[11px] text-muted">
                  <span className={cn("size-1.5 rounded-full", tone)} />
                  {label}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </PageShell>
  );
}
