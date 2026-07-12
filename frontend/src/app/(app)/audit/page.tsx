"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Lock, Plus, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useCan } from "@/context/auth";
import { ApiError, get, patch, post } from "@/lib/api";
import type { AuditCycle, AuditItem, Department, DiscrepancyReport, Employee } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const VERDICTS = ["verified", "missing", "damaged"] as const;

export default function AuditPage() {
  const queryClient = useQueryClient();
  const { isAdmin, closeAudit } = useCan();

  const [cycleId, setCycleId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [auditorIds, setAuditorIds] = useState<string[]>([]);

  const { data: cycles = [], isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: () => get<AuditCycle[]>("/audit"),
  });

  const cycle = cycles.find((item) => item.id === cycleId) ?? cycles[0];

  const { data: items = [] } = useQuery({
    queryKey: ["audit", cycle?.id, "items"],
    queryFn: () => get<AuditItem[]>(`/audit/${cycle!.id}/items`),
    enabled: Boolean(cycle),
  });

  const { data: report } = useQuery({
    queryKey: ["audit", cycle?.id, "report"],
    queryFn: () => get<DiscrepancyReport>(`/audit/${cycle!.id}/report`),
    enabled: Boolean(cycle),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => get<Employee[]>("/users"),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => get<Department[]>("/departments"),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["audit"] });
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const createCycle = useMutation({
    mutationFn: (input: Record<string, unknown>) => post<AuditCycle>("/audit", input),
    onSuccess: (created) => {
      refresh();
      setCycleId(created.id);
      setIsCreating(false);
      setAuditorIds([]);
      toast.success("Audit cycle opened", {
        description: "Every asset in scope was snapshotted into the checklist.",
      });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
      }
    },
  });

  const mark = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: string }) =>
      patch(`/audit/${cycle!.id}/items/${itemId}`, { status }),
    onSuccess: () => refresh(),
    // A closed cycle is locked, and someone who is not an auditor is refused.
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const close = useMutation({
    mutationFn: () => post<{ assetsMarkedLost: number }>(`/audit/${cycle!.id}/close`),
    onSuccess: (result) => {
      refresh();
      toast.success("Audit cycle closed and locked", {
        description: result.assetsMarkedLost
          ? `${result.assetsMarkedLost} confirmed-missing asset${
              result.assetsMarkedLost === 1 ? "" : "s"
            } marked Lost.`
          : "No assets were lost.",
      });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const progress = cycle ? Math.round((cycle.checkedItems / (cycle.totalItems || 1)) * 100) : 0;

  return (
    <PageShell
      title="Audit"
      subtitle="Structured verification cycles"
      actions={
        isAdmin && (
          <Button size="sm" onClick={() => setIsCreating(true)}>
            <Plus className="size-4" />
            New cycle
          </Button>
        )
      }
    >
      {isLoading ? (
        <div className="skeleton h-40" />
      ) : !cycles.length ? (
        <div className="card">
          <EmptyState
            title="No audit cycles yet"
            description="An audit cycle snapshots the assets in scope and gives auditors a checklist."
            icon={ClipboardCheck}
            action={
              isAdmin ? (
                <Button size="sm" onClick={() => setIsCreating(true)}>
                  <Plus className="size-4" />
                  Open a cycle
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Cycle picker */}
          {cycles.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {cycles.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCycleId(item.id)}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-all",
                    item.id === cycle?.id
                      ? "border-primary/40 bg-primary/12 text-fg"
                      : "border-line bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  {item.name}
                  {item.status === "closed" && <Lock className="ml-1 inline size-3" />}
                </button>
              ))}
            </div>
          )}

          {cycle && (
            <>
              {/* ── Cycle header ─────────────────────────────────────────── */}
              <section className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-fg">{cycle.name}</h2>
                      <StatusPill status={cycle.status === "open" ? "ongoing" : "completed"} />
                    </div>

                    <p className="mt-1 text-xs text-muted">
                      {cycle.scopeDepartmentName ?? "Whole organization"}
                      {cycle.scopeLocation && ` · ${cycle.scopeLocation}`} ·{" "}
                      {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
                    </p>

                    <p className="mt-1 text-xs text-subtle">
                      Auditors: {cycle.auditors.map((auditor) => auditor.name).join(", ") || "—"}
                    </p>
                  </div>

                  {cycle.status === "open" && closeAudit && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={close.isPending}
                      onClick={() => close.mutate()}
                    >
                      <Lock className="size-3.5" />
                      Close audit cycle
                    </Button>
                  )}
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-muted">Progress</span>
                    <span className="nums text-fg">
                      {cycle.checkedItems}/{cycle.totalItems} checked
                    </span>
                  </div>

                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full rounded-full bg-primary"
                    />
                  </div>
                </div>
              </section>

              {/* ── The auto-generated discrepancy report ────────────────── */}
              {report && report.summary.discrepancies > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-card border border-warning/30 bg-warning-soft p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-warning/15 p-2">
                      <TriangleAlert className="size-4 text-warning" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-warning">
                        {report.summary.discrepancies} asset
                        {report.summary.discrepancies === 1 ? "" : "s"} flagged — discrepancy report
                        generated automatically
                      </p>

                      <p className="mt-0.5 text-xs text-muted">
                        {report.summary.missing} missing · {report.summary.damaged} damaged ·{" "}
                        {report.summary.verified} verified
                        {report.summary.unchecked > 0 &&
                          ` · ${report.summary.unchecked} still unchecked`}
                      </p>

                      <ul className="mt-2 space-y-0.5">
                        {report.discrepancies.map((row) => (
                          <li key={row.id} className="text-xs text-muted">
                            <span className="nums font-mono text-fg">{row.assetTag}</span>{" "}
                            {row.assetName} — <span className="text-warning">{row.status}</span>
                            {row.notes && <span className="text-subtle"> · {row.notes}</span>}
                          </li>
                        ))}
                      </ul>

                      <p className="mt-2 text-[10px] text-subtle">
                        Closing the cycle marks confirmed-missing assets as <b>Lost</b> and locks it.
                      </p>
                    </div>
                  </div>
                </motion.section>
              )}

              {/* ── The checklist ───────────────────────────────────────── */}
              <section className="card overflow-hidden">
                <header className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h2 className="text-sm font-medium text-fg">Checklist</h2>

                  {cycle.status === "closed" && (
                    <span className="flex items-center gap-1 text-[11px] text-subtle">
                      <Lock className="size-3" />
                      Locked — a closed audit is evidence and cannot be edited
                    </span>
                  )}
                </header>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-line bg-surface-2">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted">
                          Asset
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted">
                          Expected location
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted">
                          Verification
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5">
                            <span className="nums font-mono text-xs text-primary">
                              {item.assetTag}
                            </span>{" "}
                            <span className="text-fg">{item.assetName}</span>
                            {item.notes && (
                              <p className="text-[11px] text-subtle italic">“{item.notes}”</p>
                            )}
                          </td>

                          <td className="px-4 py-2.5 text-muted">
                            {item.expectedLocation ?? "—"}
                          </td>

                          <td className="px-4 py-2.5">
                            {cycle.status === "closed" ? (
                              <StatusPill status={item.status} />
                            ) : (
                              <div className="flex gap-1">
                                {VERDICTS.map((verdict) => (
                                  <button
                                    key={verdict}
                                    onClick={() =>
                                      mark.mutate({ itemId: item.id, status: verdict })
                                    }
                                    disabled={mark.isPending}
                                    className={cn(
                                      "cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize transition-all",
                                      item.status === verdict
                                        ? verdict === "verified"
                                          ? "border-success/30 bg-success-soft text-success"
                                          : verdict === "missing"
                                            ? "border-danger/30 bg-danger-soft text-danger"
                                            : "border-warning/30 bg-warning-soft text-warning"
                                        : "border-line bg-surface-2 text-subtle hover:text-fg",
                                    )}
                                  >
                                    {verdict}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* ── New cycle ─────────────────────────────────────────────────── */}
      <Modal
        open={isCreating}
        onClose={() => setIsCreating(false)}
        title="Open an audit cycle"
        description="Every asset in scope is snapshotted into the checklist, with the location the system believes it is at."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button form="cycle-form" type="submit" loading={createCycle.isPending}>
              Open cycle
            </Button>
          </>
        }
      >
        <form
          id="cycle-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});

            const data = new FormData(event.currentTarget);
            createCycle.mutate({
              name: data.get("name"),
              scopeDepartmentId: data.get("scopeDepartmentId") || null,
              scopeLocation: data.get("scopeLocation") || null,
              startDate: data.get("startDate"),
              endDate: data.get("endDate"),
              auditorIds,
            });
          }}
          className="space-y-3.5"
        >
          <Field label="Name" error={errors.name} required>
            <Input name="name" placeholder="Q3 Audit — Engineering" invalid={Boolean(errors.name)} autoFocus />
          </Field>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Department scope" hint="Leave empty for the whole org.">
              <Select name="scopeDepartmentId">
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Location scope">
              <Input name="scopeLocation" placeholder="HQ Floor 2" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Start date" error={errors.startDate} required>
              <Input name="startDate" type="date" invalid={Boolean(errors.startDate)} />
            </Field>

            <Field label="End date" error={errors.endDate} required>
              <Input name="endDate" type="date" invalid={Boolean(errors.endDate)} />
            </Field>
          </div>

          <Field
            label="Auditors"
            error={errors.auditorIds}
            hint="One or more — the spec calls for a genuine many-to-many."
            required
          >
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-surface-2 p-2">
              {employees.map((employee) => {
                const picked = auditorIds.includes(employee.id);

                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() =>
                      setAuditorIds((previous) =>
                        picked
                          ? previous.filter((id) => id !== employee.id)
                          : [...previous, employee.id],
                      )
                    }
                    className={cn(
                      "cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-all",
                      picked
                        ? "border-primary/40 bg-primary/12 text-fg"
                        : "border-line bg-surface text-subtle hover:text-fg",
                    )}
                  >
                    {employee.name}
                  </button>
                );
              })}
            </div>
          </Field>
        </form>
      </Modal>
    </PageShell>
  );
}
