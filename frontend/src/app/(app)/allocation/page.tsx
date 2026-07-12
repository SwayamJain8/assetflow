"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Clock,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/data-table";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useCan } from "@/context/auth";
import { ApiError, get, post } from "@/lib/api";
import type { Allocation, Asset, Employee, Transfer } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

/** The shape the API puts in `details` when the partial unique index fires. */
type BlockedDetails = {
  holder: { id: string | null; name: string; department: string | null };
  canRequestTransfer: boolean;
};

function AllocationScreen() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { allocate: canAllocate, approveTransfer } = useCan();

  const [assetQuery, setAssetQuery] = useState("");
  const [selected, setSelected] = useState<Asset | null>(null);
  const [blocked, setBlocked] = useState<BlockedDetails | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isReturning, setIsReturning] = useState(false);

  const { data: matches = [] } = useQuery({
    queryKey: ["assets", "picker", assetQuery],
    queryFn: () => get<Asset[]>(`/assets?q=${encodeURIComponent(assetQuery)}&limit=6`),
    enabled: assetQuery.length >= 2,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => get<Employee[]>("/users"),
  });

  const { data: transfers = [] } = useQuery({
    queryKey: ["transfers"],
    queryFn: () => get<Transfer[]>("/transfers?status=requested"),
  });

  const { data: overdue = [] } = useQuery({
    queryKey: ["allocations", "overdue"],
    queryFn: () => get<Allocation[]>("/allocations?overdue=true"),
  });

  const { data: history = [] } = useQuery({
    queryKey: ["allocations", selected?.id],
    queryFn: () => get<Allocation[]>(`/allocations?assetId=${selected!.id}`),
    enabled: Boolean(selected),
  });

  // Deep link from the asset drawer: /allocation?asset=AF-0114
  useEffect(() => {
    const tag = params.get("asset");
    if (tag) setAssetQuery(tag);
  }, [params]);

  const pick = (asset: Asset) => {
    setSelected(asset);
    setErrors({});
    setAssetQuery("");
    setProof(null);

    /*
     * The mockup shows the red block the moment a held asset is chosen, so we do
     * too — derived from the holder the list already told us about.
     *
     * That banner is INFORMATIVE, not the enforcement. The enforcement is a
     * PostgreSQL index, and "Attempt it anyway" below proves it: it fires the real
     * POST and prints the database's actual refusal. A UI that only greys out a
     * button has not prevented anything — a curl request would still go through.
     */
    setBlocked(
      asset.holderName
        ? {
            holder: { id: asset.holderId, name: asset.holderName, department: null },
            canRequestTransfer: true,
          }
        : null,
    );
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["allocations"] });
    void queryClient.invalidateQueries({ queryKey: ["transfers"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  /**
   * ★ THE BLOCK.
   *
   * No pre-check runs here, and none runs on the server either. The insert is
   * attempted, PostgreSQL's partial unique index refuses it, and the 409 comes
   * back carrying the holder in `details` — which is what fills in the red banner
   * below without a second round-trip.
   */
  const allocate = useMutation({
    mutationFn: (input: Record<string, unknown>) => post("/allocations", input),
    onSuccess: async () => {
      refresh();
      toast.success(`${selected?.assetTag} allocated`);

      const [fresh] = await get<Asset[]>(`/assets?q=${selected!.assetTag}`);
      setSelected(fresh ?? null);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;

      if (error.code === "ASSET_ALREADY_ALLOCATED") {
        setBlocked(error.details as BlockedDetails);
        // Keep the server's exact words, so the banner can show that the refusal
        // came from the database and is not a message this component made up.
        setProof(`HTTP 409 ${error.code} — ${error.message}`);
        return;
      }

      setErrors(error.fieldErrors);
      if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
    },
  });

  const requestTransfer = useMutation({
    mutationFn: (input: Record<string, unknown>) => post("/transfers", input),
    onSuccess: () => {
      refresh();
      toast.success("Transfer requested", {
        description: "A manager or department head must approve it.",
      });
      setBlocked(null);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
      }
    },
  });

  const resolveTransfer = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      post(`/transfers/${id}/${action}`),
    onSuccess: (_, variables) => {
      refresh();
      toast.success(
        variables.action === "approve"
          ? "Transfer approved — the asset was re-allocated"
          : "Transfer rejected",
      );
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const returnAsset = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      post(`/allocations/${selected!.id}/return`, input),
    onSuccess: async () => {
      refresh();
      toast.success(`${selected?.assetTag} returned`, { description: "It is Available again." });
      setIsReturning(false);

      const [fresh] = await get<Asset[]>(`/assets?q=${selected!.assetTag}`);
      setSelected(fresh ?? null);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  return (
    <PageShell title="Allocation & Transfer" subtitle="Who holds what, and how it moves">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ── Asset picker ────────────────────────────────────────────── */}
          <section className="card p-4">
            <label className="mb-1.5 block text-xs font-medium text-muted">Asset</label>

            {selected ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="nums font-mono text-xs font-medium text-primary">
                    {selected.assetTag}
                  </span>
                  <span className="truncate text-sm text-fg">{selected.name}</span>
                  <StatusPill status={selected.status} />
                </div>

                <button
                  onClick={() => {
                    setSelected(null);
                    setBlocked(null);
                  }}
                  className="cursor-pointer text-subtle transition-colors hover:text-fg"
                  aria-label="Clear selection"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                <Input
                  value={assetQuery}
                  onChange={(event) => setAssetQuery(event.target.value)}
                  placeholder="Search by tag, serial, or name — e.g. AF-0114"
                  className="pl-9"
                  autoFocus
                />

                {matches.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
                    {matches.map((asset) => (
                      <li key={asset.id}>
                        <button
                          onClick={() => pick(asset)}
                          className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                        >
                          <span className="nums font-mono text-xs text-primary">
                            {asset.assetTag}
                          </span>
                          <span className="flex-1 truncate text-sm text-fg">{asset.name}</span>
                          <StatusPill status={asset.status} dot={false} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* ── ★ THE RED BLOCK ─────────────────────────────────────────── */}
          <AnimatePresence>
            {blocked && (
              <motion.section
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="rounded-card border border-danger/35 bg-danger-soft p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-danger/15 p-2">
                    <AlertOctagon className="size-4 text-danger" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-danger">
                      Already allocated to {blocked.holder.name}
                      {blocked.holder.department && ` (${blocked.holder.department})`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Direct re-allocation is blocked — submit a transfer request below.
                    </p>

                    <p className="mt-2 rounded border border-danger/20 bg-danger/5 px-2 py-1 font-mono text-[10px] text-subtle">
                      Enforced by PostgreSQL: UNIQUE INDEX one_active_allocation ON
                      allocations(asset_id) WHERE returned_at IS NULL
                    </p>

                    {proof ? (
                      <p className="mt-1.5 rounded border border-danger/30 bg-danger/10 px-2 py-1 font-mono text-[10px] text-danger">
                        {proof}
                      </p>
                    ) : (
                      canAllocate &&
                      selected && (
                        <button
                          onClick={() =>
                            allocate.mutate({
                              assetId: selected.id,
                              holderUserId: employees.find((e) => e.id !== selected.holderId)?.id,
                            })
                          }
                          disabled={allocate.isPending}
                          className="mt-1.5 cursor-pointer text-[11px] font-medium text-danger underline underline-offset-2 hover:no-underline"
                        >
                          Attempt it anyway → see the database refuse it
                        </button>
                      )
                    )}
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ── Allocate (asset is free) ────────────────────────────────── */}
          {selected && !selected.holderName && !blocked && canAllocate && (
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-medium text-fg">Allocate</h2>

              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  setErrors({});

                  const data = new FormData(event.currentTarget);
                  allocate.mutate({
                    assetId: selected.id,
                    holderUserId: data.get("holderUserId") || null,
                    expectedReturnDate: data.get("expectedReturnDate") || null,
                  });
                }}
                className="grid gap-3.5 sm:grid-cols-2"
              >
                <Field label="Allocate to" error={errors.holderUserId} required>
                  <Select name="holderUserId" invalid={Boolean(errors.holderUserId)}>
                    <option value="">Select an employee…</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                        {employee.departmentName ? ` — ${employee.departmentName}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Expected return date"
                  error={errors.expectedReturnDate}
                  hint="Past this date it is flagged overdue."
                >
                  <Input name="expectedReturnDate" type="date" />
                </Field>

                <div className="sm:col-span-2">
                  <Button type="submit" loading={allocate.isPending}>
                    Allocate asset
                  </Button>
                </div>
              </form>
            </section>
          )}

          {/* ── Held: offer return, or a transfer request ───────────────── */}
          {selected?.holderName && (
            <section className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-fg">Transfer Request</h2>

                {canAllocate && (
                  <Button size="sm" variant="secondary" onClick={() => setIsReturning(true)}>
                    <Undo2 className="size-3.5" />
                    Process return
                  </Button>
                )}
              </div>

              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  setErrors({});

                  const data = new FormData(event.currentTarget);
                  requestTransfer.mutate({
                    assetId: selected.id,
                    toUserId: data.get("toUserId"),
                    reason: data.get("reason"),
                  });
                }}
                className="space-y-3.5"
              >
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label="From">
                    {/* Read-only: the holder is a fact, not a choice. */}
                    <Input value={selected.holderName} readOnly disabled />
                  </Field>

                  <Field label="To" error={errors.toUserId} required>
                    <Select name="toUserId" invalid={Boolean(errors.toUserId)}>
                      <option value="">Select employee…</option>
                      {employees
                        .filter((employee) => employee.id !== selected.holderId)
                        .map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                            {employee.departmentName ? ` — ${employee.departmentName}` : ""}
                          </option>
                        ))}
                    </Select>
                  </Field>
                </div>

                <Field label="Reason" error={errors.reason} required>
                  <Textarea
                    name="reason"
                    placeholder="Priya is moving teams and no longer needs this machine."
                    invalid={Boolean(errors.reason)}
                    rows={3}
                  />
                </Field>

                <Button type="submit" loading={requestTransfer.isPending}>
                  Submit Request
                </Button>
              </form>
            </section>
          )}

          {/* ── Allocation history ─────────────────────────────────────── */}
          {selected && (
            <section className="card">
              <header className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-medium text-fg">Allocation history</h2>
              </header>

              {!history.length ? (
                <p className="px-4 py-8 text-center text-xs text-subtle">
                  {selected.assetTag} has never been allocated.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {history.map((row) => (
                    <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          row.returnedAt ? "bg-subtle" : row.isOverdue ? "bg-danger" : "bg-success",
                        )}
                      />

                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-fg">
                          {formatDate(row.allocatedAt)} — Allocated to{" "}
                          <span className="font-medium">
                            {row.holderName ?? row.holderDepartmentName}
                          </span>
                        </p>

                        {row.returnedAt && (
                          <p className="mt-0.5 text-[11px] text-muted">
                            Returned {formatDate(row.returnedAt)}
                            {row.returnConditionNotes && ` — “${row.returnConditionNotes}”`}
                          </p>
                        )}
                      </div>

                      {!row.returnedAt && (
                        <StatusPill status={row.isOverdue ? "missing" : "ongoing"} dot={false} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* ── Right rail: pending transfers + overdue ─────────────────── */}
        <div className="space-y-4">
          <section className="card">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg">
                <ArrowLeftRight className="size-3.5 text-subtle" />
                Pending transfers
              </h2>
              {transfers.length > 0 && (
                <span className="nums rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                  {transfers.length}
                </span>
              )}
            </header>

            {!transfers.length ? (
              <EmptyState title="No pending transfers" icon={ArrowLeftRight} />
            ) : (
              <ul className="divide-y divide-line">
                {transfers.map((transfer) => (
                  <li key={transfer.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="nums font-mono text-[11px] text-primary">
                        {transfer.assetTag}
                      </span>
                      <span className="truncate text-xs text-fg">{transfer.assetName}</span>
                    </div>

                    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                      {transfer.fromName ?? "—"}
                      <ArrowRight className="size-3" />
                      <span className="font-medium text-fg">{transfer.toName}</span>
                    </p>

                    {transfer.reason && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-subtle italic">
                        “{transfer.reason}”
                      </p>
                    )}

                    {approveTransfer && (
                      <div className="mt-2 flex gap-1.5">
                        <Button
                          size="sm"
                          variant="success"
                          className="flex-1"
                          loading={resolveTransfer.isPending}
                          onClick={() =>
                            resolveTransfer.mutate({ id: transfer.id, action: "approve" })
                          }
                        >
                          <Check className="size-3.5" />
                          Approve
                        </Button>

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            resolveTransfer.mutate({ id: transfer.id, action: "reject" })
                          }
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg">
                <Clock className="size-3.5 text-subtle" />
                Overdue returns
              </h2>
              {overdue.length > 0 && (
                <span className="nums rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                  {overdue.length}
                </span>
              )}
            </header>

            {!overdue.length ? (
              <EmptyState title="Nothing overdue" icon={Clock} />
            ) : (
              <ul className="divide-y divide-line">
                {overdue.map((row) => (
                  <li key={row.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="nums font-mono text-[11px] text-primary">
                        {row.assetTag}
                      </span>
                      <span className="truncate text-xs text-fg">{row.assetName}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-danger">
                      {row.holderName} — due {formatDate(row.expectedReturnDate)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ── Return modal ───────────────────────────────────────────────── */}
      <Modal
        open={isReturning}
        onClose={() => setIsReturning(false)}
        title={`Return ${selected?.assetTag}`}
        description="Closing the allocation frees the asset — the row survives as history."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsReturning(false)}>
              Cancel
            </Button>
            <Button form="return-form" type="submit" loading={returnAsset.isPending}>
              Mark returned
            </Button>
          </>
        }
      >
        <form
          id="return-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            returnAsset.mutate({
              returnConditionNotes: data.get("returnConditionNotes") || null,
              condition: data.get("condition"),
            });
          }}
          className="space-y-3.5"
        >
          <Field label="Condition on return">
            <Select name="condition" defaultValue={selected?.condition ?? "good"}>
              {["new", "good", "fair", "poor", "damaged"].map((value) => (
                <option key={value} value={value}>
                  {value[0]!.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Condition check-in notes">
            <Textarea
              name="returnConditionNotes"
              placeholder="Returned in good condition. Minor scuff on the lid."
              rows={3}
            />
          </Field>
        </form>
      </Modal>
    </PageShell>
  );
}

export default function AllocationPage() {
  return (
    <Suspense fallback={null}>
      <AllocationScreen />
    </Suspense>
  );
}
