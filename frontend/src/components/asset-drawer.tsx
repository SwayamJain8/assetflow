"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Boxes,
  ImageUp,
  MapPin,
  QrCode,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fileUrl, get, upload } from "@/lib/api";
import type { Asset, TimelineEntry } from "@/lib/types";
import { cn, formatCurrency, formatDate, formatDateTime, humanize } from "@/lib/utils";

type History = {
  allocationHistory: {
    id: string;
    holderName: string | null;
    allocatedAt: string;
    expectedReturnDate: string | null;
    returnedAt: string | null;
    returnConditionNotes: string | null;
  }[];
  maintenanceHistory: {
    id: string;
    issueDescription: string;
    priority: string;
    status: string;
    createdAt: string;
    resolvedAt: string | null;
  }[];
};

/** The dot colour for each lifecycle event on the timeline. */
const TIMELINE_TONE: Record<string, string> = {
  registered: "bg-brand-500 ring-brand-500/25",
  allocated: "bg-info ring-info/25",
  returned: "bg-success ring-success/25",
  transfer_approved: "bg-success ring-success/25",
  maintenance_approved: "bg-warning ring-warning/25",
  maintenance_resolved: "bg-success ring-success/25",
  maintenance_rejected: "bg-danger ring-danger/25",
  photo_updated: "bg-subtle ring-subtle/25",
  retired: "bg-subtle ring-subtle/25",
  lost: "bg-danger ring-danger/25",
};

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
export function AssetDrawer({
  asset,
  onClose,
  canManage,
}: {
  asset: Asset | null;
  onClose: () => void;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<"timeline" | "details" | "history">("timeline");
  const fileInput = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: timeline = [], isLoading: timelineLoading } = useQuery({
    queryKey: ["assets", asset?.id, "timeline"],
    queryFn: () => get<TimelineEntry[]>(`/assets/${asset!.id}/timeline`),
    enabled: Boolean(asset),
  });

  const { data: history } = useQuery({
    queryKey: ["assets", asset?.id, "history"],
    queryFn: () => get<History>(`/assets/${asset!.id}/history`),
    enabled: Boolean(asset),
  });

  async function uploadPhoto(file: File) {
    if (!asset) return;
    setIsUploading(true);

    try {
      await upload(`/assets/${asset.id}/photo`, file);
      toast.success("Photo updated");
    } catch {
      // storage.ts validates by MAGIC BYTES, so a renamed script is refused here.
      toast.error("That file was rejected. Use a real PNG, JPEG, WebP, or PDF.");
    } finally {
      setIsUploading(false);
    }
  }

  // Escape closes the drawer, as it does the modal. An overlay you can only
  // dismiss by hunting for a small x is one people feel trapped by.
  useEffect(() => {
    if (!asset) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [asset, onClose]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {asset && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />

          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-line bg-surface"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="nums font-mono text-xs font-medium text-primary">
                    {asset.assetTag}
                  </span>
                  <StatusPill status={asset.status} />
                </div>

                <h2 className="mt-1 truncate text-base font-semibold text-fg">{asset.name}</h2>

                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <MapPin className="size-3" />
                  {asset.location ?? "No location"}
                  {asset.categoryName && <span className="text-subtle">· {asset.categoryName}</span>}
                </p>
              </div>

              <button
                onClick={onClose}
                aria-label="Close"
                className="cursor-pointer rounded-md p-1 text-subtle transition-colors hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </header>

            {asset.holderName && (
              <div className="border-b border-line bg-info-soft px-5 py-2.5">
                <p className="text-xs text-fg">
                  Currently held by <span className="font-medium">{asset.holderName}</span>
                  {asset.expectedReturnDate && (
                    <span className="text-muted">
                      {" "}
                      · due back {formatDate(asset.expectedReturnDate)}
                    </span>
                  )}
                </p>
              </div>
            )}

            <div className="flex gap-1 border-b border-line px-5 py-2">
              {(["timeline", "details", "history"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    tab === item
                      ? "bg-surface-3 text-fg"
                      : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* ── THE LIFECYCLE TIMELINE ────────────────────────────────── */}
              {tab === "timeline" && (
                <div>
                  {timelineLoading && (
                    <div className="space-y-3">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="flex gap-3">
                          <div className="skeleton size-2 rounded-full" />
                          <div className="skeleton h-4 flex-1" />
                        </div>
                      ))}
                    </div>
                  )}

                  {!timelineLoading && !timeline.length && (
                    <p className="py-8 text-center text-xs text-subtle">
                      Nothing has happened to this asset yet.
                    </p>
                  )}

                  {/*
                   * This entire view is a query over activity_logs — the table every
                   * mutation already writes to. There is no timeline table, no
                   * timeline writer, and nothing that can fall out of sync with
                   * what actually happened. The feature exists because the history
                   * was modelled properly.
                   */}
                  <ol className="relative space-y-0">
                    {timeline.map((entry, index) => (
                      <motion.li
                        key={entry.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className="relative flex gap-3 pb-5 last:pb-0"
                      >
                        {index < timeline.length - 1 && (
                          <span className="absolute top-3 bottom-0 left-[3.5px] w-px bg-line" />
                        )}

                        <span
                          className={cn(
                            "relative mt-1.5 size-2 shrink-0 rounded-full ring-4",
                            TIMELINE_TONE[entry.action] ?? "bg-subtle ring-subtle/20",
                          )}
                        />

                        <div className="min-w-0 flex-1 -mt-0.5">
                          <p className="text-xs text-fg">{entry.summary}</p>
                          <p className="mt-0.5 nums text-[11px] text-subtle">
                            {formatDateTime(entry.createdAt)}
                            {entry.actorName && ` · ${entry.actorName}`}
                          </p>
                        </div>
                      </motion.li>
                    ))}
                  </ol>
                </div>
              )}

              {/* ── DETAILS + QR ──────────────────────────────────────────── */}
              {tab === "details" && (
                <div className="space-y-5">
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center gap-2">
                      {/*
                       * The QR encodes the asset TAG, not a URL or an id. That is
                       * why "search by QR code" needs no separate lookup: a scanner
                       * is a keyboard, it types AF-0114 into the same search box a
                       * human uses, and the tag match handles it.
                       */}
                      <div className="rounded-lg bg-white p-2.5">
                        <QRCodeSVG value={asset.assetTag} size={92} level="M" />
                      </div>
                      <p className="flex items-center gap-1 text-[10px] text-subtle">
                        <QrCode className="size-3" />
                        Encodes {asset.assetTag}
                      </p>
                    </div>

                    <div className="flex-1">
                      {asset.photoPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={fileUrl(asset.photoPath)!}
                          alt={asset.name}
                          className="h-23 w-full rounded-lg border border-line object-cover"
                        />
                      ) : (
                        <button
                          onClick={() => canManage && fileInput.current?.click()}
                          disabled={!canManage || isUploading}
                          className={cn(
                            "flex h-23 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-subtle transition-colors",
                            canManage && "cursor-pointer hover:border-primary/40 hover:text-muted",
                          )}
                        >
                          <ImageUp className="size-4" />
                          <span className="text-[10px]">
                            {isUploading ? "Uploading…" : canManage ? "Add a photo" : "No photo"}
                          </span>
                        </button>
                      )}

                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadPhoto(file);
                        }}
                      />
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {[
                      ["Serial number", asset.serialNumber ?? "—"],
                      ["Condition", humanize(asset.condition)],
                      ["Department", asset.departmentName ?? "—"],
                      ["Acquired", formatDate(asset.acquisitionDate)],
                      ["Cost", formatCurrency(asset.acquisitionCost)],
                      ["Bookable", asset.isBookable ? "Yes — a shared resource" : "No"],
                      ...(asset.retirementDate
                        ? [["Retires", formatDate(asset.retirementDate)] as [string, string]]
                        : []),
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[11px] text-subtle">{label}</dt>
                        <dd className="mt-0.5 text-xs text-fg">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {/* The category's own extra fields, filled in on this asset. */}
                  {Object.keys(asset.customValues).length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-medium text-muted">
                        {asset.categoryName} fields
                      </p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-surface-2 p-3">
                        {Object.entries(asset.customValues).map(([key, value]) => (
                          <div key={key}>
                            <dt className="font-mono text-[10px] text-subtle">{key}</dt>
                            <dd className="text-xs text-fg">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              )}

              {/* ── HISTORIES ─────────────────────────────────────────────── */}
              {tab === "history" && (
                <div className="space-y-5">
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg">
                      <ArrowLeftRight className="size-3.5 text-subtle" />
                      Allocation history
                    </h3>

                    {!history?.allocationHistory.length ? (
                      <p className="text-xs text-subtle">Never allocated.</p>
                    ) : (
                      <ul className="space-y-2">
                        {history.allocationHistory.map((row) => (
                          <li
                            key={row.id}
                            className="rounded-lg border border-line bg-surface-2 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-fg">
                                {row.holderName ?? "A department"}
                              </p>
                              <StatusPill
                                status={row.returnedAt ? "completed" : "ongoing"}
                                dot={false}
                                className="text-[10px]"
                              />
                            </div>

                            <p className="nums mt-0.5 text-[11px] text-subtle">
                              {formatDate(row.allocatedAt)}
                              {row.returnedAt
                                ? ` → returned ${formatDate(row.returnedAt)}`
                                : row.expectedReturnDate
                                  ? ` · due ${formatDate(row.expectedReturnDate)}`
                                  : ""}
                            </p>

                            {row.returnConditionNotes && (
                              <p className="mt-1 text-[11px] text-muted italic">
                                “{row.returnConditionNotes}”
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg">
                      <Wrench className="size-3.5 text-subtle" />
                      Maintenance history
                    </h3>

                    {!history?.maintenanceHistory.length ? (
                      <p className="text-xs text-subtle">No maintenance recorded.</p>
                    ) : (
                      <ul className="space-y-2">
                        {history.maintenanceHistory.map((row) => (
                          <li
                            key={row.id}
                            className="rounded-lg border border-line bg-surface-2 px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="flex-1 text-xs text-fg">{row.issueDescription}</p>
                              <StatusPill status={row.status} dot={false} className="text-[10px]" />
                            </div>
                            <p className="nums mt-0.5 text-[11px] text-subtle">
                              {formatDate(row.createdAt)}
                              {row.resolvedAt && ` → resolved ${formatDate(row.resolvedAt)}`}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
            </div>

            <footer className="flex gap-2 border-t border-line bg-surface-2 px-5 py-3">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => (window.location.href = `/allocation?asset=${asset.assetTag}`)}
              >
                <Boxes className="size-3.5" />
                {asset.holderName ? "Transfer / return" : "Allocate"}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => (window.location.href = `/maintenance?asset=${asset.assetTag}`)}
              >
                <Undo2 className="size-3.5" />
                Raise maintenance
              </Button>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
