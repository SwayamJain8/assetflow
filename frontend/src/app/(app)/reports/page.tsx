"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Flame, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { get } from "@/lib/api";
import type { Reports } from "@/lib/types";
import { cn, downloadCsv } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type UtilizationRow = Reports["utilizationByDepartment"][number];

/**
 * Charts read their colours from the CSS variables, not from hard-coded hex — so
 * when an organization's logo re-skins the app, the charts re-skin with it.
 * Recharts needs concrete strings, so we read the computed values at render.
 */
const cssVar = (name: string) =>
  typeof window === "undefined"
    ? "#0d9488"
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#0d9488";

function ChartCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-fg">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

export default function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: () => get<Reports>("/reports"),
  });

  if (isLoading || !data) {
    return (
      <PageShell title="Reports" subtitle="Operational insight">
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-64" />
          ))}
        </div>
      </PageShell>
    );
  }

  const brand = cssVar("--brand-500");
  const warning = cssVar("--warning");
  const danger = cssVar("--danger");
  const line = cssVar("--border");
  const muted = cssVar("--text-muted");

  // The heatmap: 7 days × the hours that actually have bookings.
  const hours = [...new Set(data.bookingHeatmap.map((cell) => cell.hour))].sort((a, b) => a - b);
  const peak = Math.max(1, ...data.bookingHeatmap.map((cell) => cell.bookings));
  const cellAt = (day: number, hour: number) =>
    data.bookingHeatmap.find((cell) => cell.dayOfWeek === day && cell.hour === hour)?.bookings ?? 0;

  // Exports are generated in the BROWSER — no server round-trip, no PDF library,
  // and the CSV quotes every value so a description containing a comma cannot
  // shift every column after it.
  const exportAll = () =>
    downloadCsv(
      `assetflow-utilization-${new Date().toISOString().slice(0, 10)}.csv`,
      data.utilizationByDepartment,
    );

  const tooltipStyle = {
    background: "var(--surface)",
    border: `1px solid ${line}`,
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text)",
  };

  return (
    <PageShell
      title="Reports"
      subtitle="Utilization, maintenance, and idle assets"
      actions={
        <Button size="sm" variant="secondary" onClick={exportAll}>
          <Download className="size-4" />
          Export report
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Utilization by department ─────────────────────────────────── */}
        <ChartCard
          title="Utilization by department"
          subtitle="Share of each department's assets that are actually in someone's hands"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.utilizationByDepartment} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={line} vertical={false} />
              <XAxis
                dataKey="department"
                tick={{ fontSize: 11, fill: muted }}
                axisLine={{ stroke: line }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: muted }}
                axisLine={false}
                tickLine={false}
                unit="%"
              />
              {/*
               * The formatter is typed loosely on purpose: Recharts' Formatter
               * generic does not line up with a narrowed (value: number) signature,
               * and the production build rejects it even though the dev server does
               * not. The runtime shape is exactly what the query returns.
               */}
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: brand, fillOpacity: 0.06 }}
                formatter={((value: number, _name: string, item: { payload: UtilizationRow }) => [
                  `${value}% (${item.payload.allocated}/${item.payload.total} allocated)`,
                  "Utilization",
                ]) as never}
              />
              <Bar dataKey="utilization" fill={brand} radius={[4, 4, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ── Maintenance frequency ─────────────────────────────────────── */}
        <ChartCard
          title="Maintenance frequency"
          subtitle="Requests per month over the last year"
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={data.maintenanceFrequency.byMonth}
              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={line} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={(month: string) => month.slice(5)}
                tick={{ fontSize: 11, fill: muted }}
                axisLine={{ stroke: line }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: muted }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="requests"
                stroke={danger}
                strokeWidth={2}
                dot={{ r: 2.5, fill: danger }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>

          <p className="mt-2 text-[10px] text-subtle">
            Months with no maintenance are plotted as zero, not omitted — otherwise the line would
            draw straight across the gap as if nothing had changed.
          </p>
        </ChartCard>

        {/* ── Most used / idle ──────────────────────────────────────────── */}
        <ChartCard title="Most used assets" subtitle="Allocations and bookings combined">
          <ul className="space-y-2">
            {data.mostUsed.map((row) => (
              <li key={row.assetTag} className="flex items-center gap-3">
                <span className="nums w-16 shrink-0 font-mono text-[11px] text-primary">
                  {row.assetTag}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{row.name}</span>
                <span className="nums text-xs text-muted">
                  {row.uses} use{row.uses === 1 ? "" : "s"}
                </span>
              </li>
            ))}
            {!data.mostUsed.length && <p className="text-xs text-subtle">No usage yet.</p>}
          </ul>

          <p className="mt-3 text-[10px] text-subtle">
            A room is never allocated and a laptop is never booked — counting only one would rank
            every room as idle.
          </p>
        </ChartCard>

        <ChartCard title="Idle assets" subtitle="Available, but nobody has touched them">
          <ul className="space-y-2">
            {data.idle.map((row) => (
              <li key={row.assetTag} className="flex items-center gap-3">
                <span className="nums w-16 shrink-0 font-mono text-[11px] text-primary">
                  {row.assetTag}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{row.name}</span>
                <span className="nums text-xs text-warning">unused {row.idleDays}d</span>
              </li>
            ))}
            {!data.idle.length && <p className="text-xs text-subtle">Nothing is idle.</p>}
          </ul>
        </ChartCard>

        {/* ── Booking heatmap ───────────────────────────────────────────── */}
        <ChartCard
          title="Booking heatmap"
          subtitle="Peak usage windows across the last 90 days"
        >
          {!hours.length ? (
            <p className="py-8 text-center text-xs text-subtle">No bookings yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-0.5">
                <thead>
                  <tr>
                    <th />
                    {hours.map((hour) => (
                      <th
                        key={hour}
                        className="nums pb-1 text-center text-[9px] font-normal text-subtle"
                      >
                        {hour}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {DAYS.map((label, day) => (
                    <tr key={label}>
                      <td className="pr-1.5 text-right text-[10px] text-subtle">{label}</td>

                      {hours.map((hour) => {
                        const count = cellAt(day, hour);

                        return (
                          <td key={hour}>
                            <div
                              title={`${label} ${hour}:00 — ${count} booking${count === 1 ? "" : "s"}`}
                              className="size-5 rounded-sm border border-line"
                              style={{
                                background: count
                                  ? brand
                                  : "var(--surface-2)",
                                opacity: count ? 0.25 + (count / peak) * 0.75 : 1,
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-2 text-[10px] text-subtle">
                A three-hour booking lights three cells, not one — counting only start times would
                make a whole afternoon look free.
              </p>
            </div>
          )}
        </ChartCard>

        {/* ── Needs attention ───────────────────────────────────────────── */}
        <ChartCard
          title="Due for maintenance / nearing retirement"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                downloadCsv("assetflow-attention.csv", data.attentionNeeded)
              }
            >
              <Download className="size-3.5" />
            </Button>
          }
        >
          <ul className="space-y-2">
            {data.attentionNeeded.map((row) => (
              <li key={`${row.assetTag}-${row.reason}`} className="flex items-center gap-3">
                <span className="nums w-16 shrink-0 font-mono text-[11px] text-primary">
                  {row.assetTag}
                </span>

                <span className="min-w-0 flex-1 truncate text-xs text-fg">{row.name}</span>

                <span
                  className={cn(
                    "flex items-center gap-1 text-[11px]",
                    row.reason === "nearing_retirement" ? "text-warning" : "text-danger",
                  )}
                >
                  {row.reason === "nearing_retirement" ? (
                    <>
                      <TrendingUp className="size-3" />
                      retires in {row.days}d
                    </>
                  ) : (
                    <>
                      <Flame className="size-3" />
                      poor condition
                    </>
                  )}
                </span>
              </li>
            ))}
            {!data.attentionNeeded.length && (
              <p className="text-xs text-subtle">Nothing needs attention.</p>
            )}
          </ul>
        </ChartCard>
      </div>

      {/* ── Department allocation summary ──────────────────────────────── */}
      <div className="card mt-4 overflow-hidden">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium text-fg">Department allocation summary</h2>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => downloadCsv("assetflow-allocation-summary.csv", data.allocationSummary)}
          >
            <Download className="size-3.5" />
            CSV
          </Button>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2">
              <tr>
                {["Department", "Employees", "Assets held", "Overdue"].map((header) => (
                  <th
                    key={header}
                    className="px-4 py-2.5 text-left text-xs font-medium text-muted"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {data.allocationSummary.map((row) => (
                <tr key={row.department} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium text-fg">{row.department}</td>
                  <td className="nums px-4 py-2.5 text-muted">{row.employees}</td>
                  <td className="nums px-4 py-2.5 text-muted">{row.assetsHeld}</td>
                  <td className="nums px-4 py-2.5">
                    {row.overdue ? (
                      <span className="text-danger">{row.overdue}</span>
                    ) : (
                      <span className="text-subtle">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
