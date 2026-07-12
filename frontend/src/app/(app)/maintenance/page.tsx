"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GripVertical, Plus, Search } from "lucide-react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useCan } from "@/context/auth";
import { ApiError, get, patch, post } from "@/lib/api";
import type { Asset, Employee, MaintenanceRequest, MaintenanceStatus } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

/** The 5 columns from the mockup. `rejected` is a terminal state, shown inline. */
const COLUMNS: { id: MaintenanceStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "technician_assigned", label: "Technician assigned" },
  { id: "in_progress", label: "In progress" },
  { id: "resolved", label: "Resolved" },
];

const PRIORITY_TONE: Record<string, string> = {
  low: "text-subtle",
  medium: "text-info",
  high: "text-warning",
  critical: "text-danger",
};

function MaintenanceScreen() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { moveMaintenance } = useCan();

  const [isRaising, setIsRaising] = useState(false);
  const [assetQuery, setAssetQuery] = useState("");
  const [pickedAsset, setPickedAsset] = useState<Asset | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /*
   * The dragged card lives in a REF, not in state.
   *
   * setState is asynchronous: onDragStart schedules an update, and if the drop
   * lands before React has re-rendered, the drop handler still closes over the OLD
   * value — null — and silently does nothing. A slow human hand hides that; a fast
   * one, or a synthetic event, does not. A ref is written and read in the same tick.
   *
   * `draggingId` is separate state purely to fade the card being dragged — that IS
   * a render concern, so state is right for it.
   */
  const draggedRef = useRef<MaintenanceRequest | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<MaintenanceStatus | null>(null);

  /** Set when a move needs more input than a drag can carry. */
  const [needsInput, setNeedsInput] = useState<{
    request: MaintenanceRequest;
    to: MaintenanceStatus;
  } | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["maintenance"],
    queryFn: () => get<MaintenanceRequest[]>("/maintenance"),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => get<Employee[]>("/users"),
  });

  const { data: assetMatches = [] } = useQuery({
    queryKey: ["assets", "picker", assetQuery],
    queryFn: () => get<Asset[]>(`/assets?q=${encodeURIComponent(assetQuery)}&limit=6`),
    enabled: assetQuery.length >= 2,
  });

  useEffect(() => {
    const tag = params.get("asset");
    if (tag) {
      setIsRaising(true);
      setAssetQuery(tag);
    }
    if (params.get("new") === "1") setIsRaising(true);
  }, [params]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const raise = useMutation({
    mutationFn: (input: Record<string, unknown>) => post("/maintenance", input),
    onSuccess: () => {
      refresh();
      toast.success("Maintenance request raised", {
        description: "It is Pending — work cannot begin until a manager approves it.",
      });
      setIsRaising(false);
      setPickedAsset(null);
      setErrors({});
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
      }
    },
  });

  /**
   * The one endpoint the whole board drives.
   *
   * Note there is NO client-side check of whether a move is legal. The server owns
   * the state machine — `pending` simply has no edge to `in_progress` — so dragging
   * a card across two columns is refused there, and the 409 names the moves that
   * WOULD have worked. Duplicating that table here would just create a second copy
   * to drift.
   */
  const move = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) =>
      patch(`/maintenance/${id}`, input),
    onSuccess: (_, variables) => {
      refresh();
      setNeedsInput(null);

      const messages: Partial<Record<string, string>> = {
        approved: "Approved — the asset is now Under Maintenance",
        resolved: "Resolved — the asset is available again",
        rejected: "Request rejected",
      };

      toast.success(messages[variables.status as string] ?? "Moved");
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;

      if (error.code === "ILLEGAL_TRANSITION") {
        // The approval gate, explained by the server.
        toast.error(error.message, {
          description: "Work cannot start before approval — the state machine forbids it.",
          duration: 6000,
        });
        return;
      }

      toast.error(error.message);
    },
  });

  function drop(to: MaintenanceStatus) {
    setDragOver(null);

    const request = draggedRef.current;
    draggedRef.current = null;
    setDraggingId(null);

    if (!request || request.status === to) return;

    // Two moves carry information a drag cannot: who the technician is, and why a
    // request was rejected. Ask, rather than sending an incomplete PATCH.
    if (to === "technician_assigned" || to === "rejected") {
      setNeedsInput({ request, to });
      return;
    }

    move.mutate({ id: request.id, status: to });
  }

  /**
   * Resolved requests accumulate forever, and a column with fifty closed cards
   * buries the four that still need someone's attention. The board shows the most
   * recent few and SAYS how many it is hiding — a silent truncation would be worse
   * than the clutter, because it would look like the history simply is not there.
   */
  const RESOLVED_SHOWN = 4;

  const byColumn = (status: MaintenanceStatus) => {
    const all = requests.filter((request) => request.status === status);
    return status === "resolved" ? all.slice(0, RESOLVED_SHOWN) : all;
  };

  const resolvedTotal = requests.filter((request) => request.status === "resolved").length;
  const resolvedHidden = Math.max(0, resolvedTotal - RESOLVED_SHOWN);

  const rejected = requests.filter((request) => request.status === "rejected");

  return (
    <PageShell
      title="Maintenance"
      subtitle="Repairs must be approved before work begins"
      actions={
        <Button size="sm" onClick={() => setIsRaising(true)}>
          <Plus className="size-4" />
          Raise request
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-card border border-info/25 bg-info-soft px-3.5 py-2.5">
          <AlertTriangle className="mt-px size-4 shrink-0 text-info" />
          <p className="text-xs leading-relaxed text-muted">
            <span className="font-medium text-fg">Approving a card moves the asset to Under
            Maintenance; resolving returns it.</span>{" "}
            A Pending request cannot be dragged past Approved — the server&apos;s state machine has
            no edge from Pending to In Progress, so work cannot start unapproved.
          </p>
        </div>

        {/* ── The board ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((column) => {
            const cards = byColumn(column.id);

            return (
              <div
                key={column.id}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(column.id);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => drop(column.id)}
                className={cn(
                  "flex min-h-64 flex-col rounded-card border bg-surface-2/50 transition-colors",
                  dragOver === column.id
                    ? "border-primary/50 bg-primary/[0.05]"
                    : "border-line",
                )}
              >
                <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
                  <h2 className="text-xs font-medium text-fg">{column.label}</h2>
                  <span className="nums rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    {column.id === "resolved" ? resolvedTotal : cards.length}
                  </span>
                </header>

                <div className="flex-1 space-y-2 p-2">
                  {isLoading &&
                    Array.from({ length: 2 }).map((_, index) => (
                      <div key={index} className="skeleton h-20" />
                    ))}

                  {!isLoading && !cards.length && (
                    <p className="py-6 text-center text-[11px] text-subtle">Nothing here</p>
                  )}

                  {cards.map((request) => (
                    <motion.article
                      key={request.id}
                      layout
                      draggable={moveMaintenance}
                      onDragStart={() => {
                        draggedRef.current = request;
                        setDraggingId(request.id);
                      }}
                      onDragEnd={() => {
                        draggedRef.current = null;
                        setDraggingId(null);
                        setDragOver(null);
                      }}
                      className={cn(
                        "group rounded-lg border border-line bg-surface p-2.5 transition-all",
                        moveMaintenance && "cursor-grab active:cursor-grabbing hover:border-line-strong",
                        draggingId === request.id && "opacity-40",
                        request.status === "resolved" && "border-success/30 bg-success-soft",
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        {moveMaintenance && (
                          <GripVertical className="mt-0.5 size-3 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="nums font-mono text-[11px] font-medium text-primary">
                              {request.assetTag}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] font-medium capitalize",
                                PRIORITY_TONE[request.priority],
                              )}
                            >
                              {request.priority}
                            </span>
                          </div>

                          <p className="mt-1 line-clamp-2 text-xs text-fg">
                            {request.issueDescription}
                          </p>

                          {request.technicianName && (
                            <p className="mt-1 text-[10px] text-muted">
                              tech: {request.technicianName}
                            </p>
                          )}

                          <p className="mt-1 text-[10px] text-subtle">
                            {request.reportedByName} · {timeAgo(request.createdAt)}
                          </p>
                        </div>
                      </div>
                    </motion.article>
                  ))}

                  {column.id === "resolved" && resolvedHidden > 0 && (
                    <p className="py-2 text-center text-[10px] text-subtle">
                      + {resolvedHidden} older resolved
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Rejected requests are terminal — off the board, but not hidden. */}
        {rejected.length > 0 && (
          <section className="card">
            <header className="border-b border-line px-4 py-2.5">
              <h2 className="text-xs font-medium text-fg">
                Rejected ({rejected.length})
              </h2>
            </header>

            <ul className="divide-y divide-line">
              {rejected.map((request) => (
                <li key={request.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="nums font-mono text-[11px] text-primary">
                    {request.assetTag}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {request.issueDescription}
                  </span>
                  {request.rejectionReason && (
                    <span className="truncate text-[11px] text-subtle italic">
                      “{request.rejectionReason}”
                    </span>
                  )}
                  <StatusPill status="rejected" dot={false} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ── Raise a request ───────────────────────────────────────────── */}
      <Modal
        open={isRaising}
        onClose={() => {
          setIsRaising(false);
          setPickedAsset(null);
          setErrors({});
        }}
        title="Raise maintenance request"
        description="Any employee may raise one. It enters as Pending — work cannot begin until it is approved."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsRaising(false)}>
              Cancel
            </Button>
            <Button form="maintenance-form" type="submit" loading={raise.isPending}>
              Raise request
            </Button>
          </>
        }
      >
        <form
          id="maintenance-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});

            const data = new FormData(event.currentTarget);
            raise.mutate({
              assetId: pickedAsset?.id,
              issueDescription: data.get("issueDescription"),
              priority: data.get("priority"),
            });
          }}
          className="space-y-3.5"
        >
          <Field label="Asset" error={errors.assetId} required>
            {pickedAsset ? (
              <button
                type="button"
                onClick={() => setPickedAsset(null)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left"
              >
                <span className="nums font-mono text-xs text-primary">
                  {pickedAsset.assetTag}
                </span>
                <span className="flex-1 truncate text-sm text-fg">{pickedAsset.name}</span>
                <StatusPill status={pickedAsset.status} dot={false} />
              </button>
            ) : (
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                <Input
                  value={assetQuery}
                  onChange={(event) => setAssetQuery(event.target.value)}
                  placeholder="Search by tag or name…"
                  className="pl-9"
                  invalid={Boolean(errors.assetId)}
                />

                {assetMatches.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
                    {assetMatches.map((asset) => (
                      <li key={asset.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPickedAsset(asset);
                            setAssetQuery("");
                          }}
                          className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2"
                        >
                          <span className="nums font-mono text-xs text-primary">
                            {asset.assetTag}
                          </span>
                          <span className="flex-1 truncate text-sm text-fg">{asset.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>

          <Field label="What is wrong?" error={errors.issueDescription} required>
            <Textarea
              name="issueDescription"
              placeholder="Projector bulb not turning on."
              rows={3}
              invalid={Boolean(errors.issueDescription)}
            />
          </Field>

          <Field label="Priority">
            <Select name="priority" defaultValue="medium">
              {["low", "medium", "high", "critical"].map((value) => (
                <option key={value} value={value}>
                  {value[0]!.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      {/* ── The two moves that need more than a drag ──────────────────── */}
      <Modal
        open={Boolean(needsInput)}
        onClose={() => setNeedsInput(null)}
        title={
          needsInput?.to === "technician_assigned" ? "Assign a technician" : "Reject this request"
        }
        description={
          needsInput?.to === "technician_assigned"
            ? "A drag cannot carry a name, so the API asks for one."
            : "A rejection needs a reason — the person who raised it will be told."
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNeedsInput(null)}>
              Cancel
            </Button>
            <Button form="transition-form" type="submit" loading={move.isPending}>
              {needsInput?.to === "technician_assigned" ? "Assign" : "Reject"}
            </Button>
          </>
        }
      >
        {needsInput && (
          <form
            id="transition-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);

              move.mutate({
                id: needsInput.request.id,
                status: needsInput.to,
                technicianId: data.get("technicianId") || undefined,
                rejectionReason: data.get("rejectionReason") || undefined,
              });
            }}
            className="space-y-3.5"
          >
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="nums font-mono text-primary">{needsInput.request.assetTag}</span>{" "}
              <span className="text-muted">— {needsInput.request.issueDescription}</span>
            </p>

            {needsInput.to === "technician_assigned" ? (
              <Field label="Technician" required>
                <Select name="technicianId" autoFocus>
                  <option value="">Select…</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Reason" required>
                <Textarea
                  name="rejectionReason"
                  placeholder="Not economical to repair — schedule a replacement."
                  rows={3}
                  autoFocus
                />
              </Field>
            )}
          </form>
        )}
      </Modal>
    </PageShell>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={null}>
      <MaintenanceScreen />
    </Suspense>
  );
}
