"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, CalendarClock, ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { ApiError, get, post } from "@/lib/api";
import type { Booking, Resource } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

/** The grid runs 08:00–20:00 in 30-minute rows. */
const START_HOUR = 8;
const END_HOUR = 20;
const SLOT_MINUTES = 30;
const SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;
const ROW_PX = 28;

type Conflict = { id: string; startsAt: string; endsAt: string; purpose: string | null; bookedByName: string };

/** Local midnight for a YYYY-MM-DD, so the grid means the user's day. */
const dayStart = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 0, 0, 0, 0);
};

const slotToDate = (day: string, slot: number) => {
  const date = dayStart(day);
  date.setMinutes(START_HOUR * 60 + slot * SLOT_MINUTES);
  return date;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function BookingPage() {
  const queryClient = useQueryClient();

  const [resourceId, setResourceId] = useState("");
  const [day, setDay] = useState(today());
  const [draft, setDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: resources = [] } = useQuery({
    queryKey: ["assets", "resources"],
    queryFn: () => get<Resource[]>("/resources"),
  });

  const resource = resources.find((item) => item.id === resourceId) ?? resources[0];

  const from = dayStart(day).toISOString();
  const to = new Date(dayStart(day).getTime() + 86_400_000).toISOString();

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["bookings", resource?.id, day],
    queryFn: () =>
      get<Booking[]>(`/bookings?resourceId=${resource!.id}&from=${from}&to=${to}`),
    enabled: Boolean(resource),
  });

  const visible = bookings.filter((booking) => booking.status !== "cancelled");

  /** Which grid rows a conflict covers, so they can be flashed red. */
  const conflictRows = useMemo(() => {
    const rows = new Set<number>();

    for (const conflict of conflicts) {
      const start = new Date(conflict.startsAt);
      const end = new Date(conflict.endsAt);
      const base = dayStart(day).getTime() + START_HOUR * 3600_000;

      const first = Math.floor((start.getTime() - base) / (SLOT_MINUTES * 60_000));
      const last = Math.ceil((end.getTime() - base) / (SLOT_MINUTES * 60_000));

      for (let slot = Math.max(0, first); slot < Math.min(SLOTS, last); slot++) rows.add(slot);
    }

    return rows;
  }, [conflicts, day]);

  /**
   * ★ GOLDEN SCENARIO #2.
   *
   * No availability check runs before this POST — not here, and not on the server.
   * The insert is attempted, and PostgreSQL's EXCLUDE constraint refuses it if the
   * range overlaps. The 409 carries the clashing bookings in `details.conflicts`,
   * which is what paints the red rows below.
   *
   * A client-side "is this slot free?" check would be a lie under concurrency: two
   * people clicking the same slot in the same second would both be told yes.
   */
  const book = useMutation({
    mutationFn: (input: Record<string, unknown>) => post("/bookings", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Booking confirmed");
      setDraft(null);
      setConflicts([]);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;

      if (error.code === "BOOKING_OVERLAP") {
        const details = error.details as { conflicts: Conflict[] };
        setConflicts(details.conflicts ?? []);
        setDraft(null);

        toast.error(error.message, { description: "The clashing slots are highlighted in red." });
        return;
      }

      setErrors(error.fieldErrors);
      if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => post(`/bookings/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      // The constraint's WHERE status <> 'cancelled' means the slot is free again
      // the instant this lands — the row survives as history.
      toast.success("Booking cancelled — the slot is free again");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const shiftDay = (days: number) => {
    const date = dayStart(day);
    date.setDate(date.getDate() + days);
    setDay(date.toISOString().slice(0, 10));
    setConflicts([]);
  };

  /** Click a free row → propose a one-hour booking starting there. */
  const openDraft = (slot: number) => {
    setConflicts([]);
    setErrors({});
    setDraft({ start: slotToDate(day, slot), end: slotToDate(day, slot + 2) });
  };

  const isToday = day === today();

  return (
    <PageShell title="Resource Booking" subtitle="Shared rooms, vehicles and equipment">
      <div className="grid gap-5 lg:grid-cols-4">
        {/* ── Resource picker ─────────────────────────────────────────── */}
        <aside className="space-y-2 lg:col-span-1">
          <p className="text-xs font-medium text-muted">Resource</p>

          {resources.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setResourceId(item.id);
                setConflicts([]);
              }}
              className={cn(
                "w-full cursor-pointer rounded-lg border p-3 text-left transition-all",
                item.id === resource?.id
                  ? "border-primary/40 bg-primary/[0.06]"
                  : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="nums font-mono text-[11px] text-primary">{item.assetTag}</span>
                <span className="truncate text-sm font-medium text-fg">{item.name}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                {item.location ?? "—"} · {item.categoryName ?? "Resource"}
              </p>
            </button>
          ))}

          {!resources.length && (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-subtle">
              No bookable resources. Mark an asset as a shared resource when registering it.
            </p>
          )}
        </aside>

        {/* ── The day grid ────────────────────────────────────────────── */}
        <div className="lg:col-span-3">
          <div className="card overflow-hidden">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-medium text-fg">
                  {resource?.name ?? "Select a resource"}
                </h2>
                <p className="text-xs text-muted">
                  {dayStart(day).toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                  {isToday && <span className="text-primary"> · today</span>}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => shiftDay(-1)} aria-label="Previous day">
                  <ChevronLeft className="size-4" />
                </Button>

                <Input
                  type="date"
                  value={day}
                  onChange={(event) => {
                    setDay(event.target.value);
                    setConflicts([]);
                  }}
                  className="h-8 w-36 text-xs"
                />

                <Button size="icon" variant="ghost" onClick={() => shiftDay(1)} aria-label="Next day">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </header>

            {conflicts.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="flex items-start gap-2.5 border-b border-danger/25 bg-danger-soft px-4 py-2.5"
              >
                <AlertOctagon className="mt-px size-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-danger">
                    Slot unavailable — it overlaps an existing booking
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-subtle">
                    Refused by PostgreSQL: EXCLUDE USING gist (resource_id WITH =, during WITH &amp;&amp;)
                    WHERE status &lt;&gt; &apos;cancelled&apos;
                  </p>
                </div>
                <button
                  onClick={() => setConflicts([])}
                  className="cursor-pointer text-subtle hover:text-fg"
                  aria-label="Dismiss"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            )}

            <div className="relative overflow-x-auto p-4">
              {isLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="skeleton h-6" />
                  ))}
                </div>
              ) : (
                <div className="relative flex">
                  {/* Hour gutter */}
                  <div className="w-14 shrink-0">
                    {Array.from({ length: END_HOUR - START_HOUR }).map((_, index) => (
                      <div
                        key={index}
                        style={{ height: ROW_PX * 2 }}
                        className="nums -translate-y-1.5 text-right text-[11px] text-subtle"
                      >
                        {String(START_HOUR + index).padStart(2, "0")}:00
                      </div>
                    ))}
                  </div>

                  {/* Clickable slots */}
                  <div className="relative flex-1 border-l border-line">
                    {Array.from({ length: SLOTS }).map((_, slot) => (
                      <button
                        key={slot}
                        onClick={() => openDraft(slot)}
                        style={{ height: ROW_PX }}
                        className={cn(
                          "block w-full cursor-pointer border-b transition-colors",
                          slot % 2 === 1 ? "border-line" : "border-line/40",
                          conflictRows.has(slot)
                            ? // The exclusion constraint, made visible.
                              "border-danger/40 bg-danger/20"
                            : "hover:bg-primary/[0.07]",
                        )}
                        aria-label={`Book ${formatTime(slotToDate(day, slot).toISOString())}`}
                      />
                    ))}

                    {/* Existing bookings, positioned over the grid */}
                    {visible.map((booking) => {
                      const start = new Date(booking.startsAt);
                      const end = new Date(booking.endsAt);
                      const base = dayStart(day).getTime() + START_HOUR * 3600_000;

                      const top = ((start.getTime() - base) / (SLOT_MINUTES * 60_000)) * ROW_PX;
                      const height =
                        ((end.getTime() - start.getTime()) / (SLOT_MINUTES * 60_000)) * ROW_PX;

                      // Clamp to the visible window rather than overflowing it.
                      const clampedTop = Math.max(0, top);
                      const clampedHeight = Math.min(height + Math.min(0, top), SLOTS * ROW_PX - clampedTop);

                      if (clampedHeight <= 0) return null;

                      return (
                        <motion.div
                          key={booking.id}
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          style={{ top: clampedTop, height: clampedHeight }}
                          className={cn(
                            "group absolute right-1 left-1 overflow-hidden rounded-md border px-2 py-1",
                            booking.status === "ongoing"
                              ? "border-brand-500/40 bg-brand-500/20"
                              : booking.status === "completed"
                                ? "border-line bg-surface-3"
                                : "border-info/40 bg-info/20",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="nums truncate text-[11px] font-medium text-fg">
                                {formatTime(booking.startsAt)}–{formatTime(booking.endsAt)}
                                {booking.purpose && (
                                  <span className="font-normal text-muted"> · {booking.purpose}</span>
                                )}
                              </p>
                              <p className="truncate text-[10px] text-subtle">
                                {booking.bookedByName}
                              </p>
                            </div>

                            {booking.status !== "completed" && booking.isMine && (
                              <button
                                onClick={() => cancel.mutate(booking.id)}
                                className="shrink-0 cursor-pointer rounded p-0.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                                aria-label="Cancel booking"
                              >
                                <X className="size-3" />
                              </button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}

                    {/* The slot being proposed */}
                    <AnimatePresence>
                      {draft && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          style={{
                            top:
                              ((draft.start.getTime() -
                                (dayStart(day).getTime() + START_HOUR * 3600_000)) /
                                (SLOT_MINUTES * 60_000)) *
                              ROW_PX,
                            height:
                              ((draft.end.getTime() - draft.start.getTime()) /
                                (SLOT_MINUTES * 60_000)) *
                              ROW_PX,
                          }}
                          className="pointer-events-none absolute right-1 left-1 rounded-md border-2 border-dashed border-primary bg-primary/10"
                        />
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-line bg-surface-2 px-4 py-2.5">
              <p className="text-[11px] text-subtle">
                Click any free slot to book it. Overlaps are refused by the database.
              </p>

              <div className="flex items-center gap-3 text-[10px] text-subtle">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm border border-info/40 bg-info/20" /> Booked
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm border border-danger/40 bg-danger/20" /> Conflict
                </span>
              </div>
            </footer>
          </div>

          {/* Today's bookings for this resource, as a list. */}
          {visible.length > 0 && (
            <div className="card mt-4">
              <header className="border-b border-line px-4 py-2.5">
                <h3 className="text-xs font-medium text-fg">
                  {visible.length} booking{visible.length === 1 ? "" : "s"} on this day
                </h3>
              </header>

              <ul className="divide-y divide-line">
                {visible.map((booking) => (
                  <li key={booking.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="nums w-24 shrink-0 text-xs text-fg">
                      {formatTime(booking.startsAt)}–{formatTime(booking.endsAt)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">
                      {booking.purpose ?? "—"}
                    </span>
                    <span className="text-[11px] text-subtle">{booking.bookedByName}</span>
                    <StatusPill status={booking.status} dot={false} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── Booking modal ─────────────────────────────────────────────── */}
      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={`Book ${resource?.name ?? ""}`}
        description="Two bookings of one resource cannot overlap — PostgreSQL refuses the write."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button form="booking-form" type="submit" loading={book.isPending}>
              Book a slot
            </Button>
          </>
        }
      >
        {draft && (
          <form
            id="booking-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setErrors({});

              const data = new FormData(event.currentTarget);
              const [sh, sm] = String(data.get("start")).split(":").map(Number);
              const [eh, em] = String(data.get("end")).split(":").map(Number);

              const start = dayStart(day);
              start.setHours(sh!, sm!, 0, 0);

              const end = dayStart(day);
              end.setHours(eh!, em!, 0, 0);

              book.mutate({
                resourceId: resource!.id,
                // The browser knows the user's timezone; the server never guesses.
                startsAt: start.toISOString(),
                endsAt: end.toISOString(),
                purpose: data.get("purpose") || null,
              });
            }}
            className="space-y-3.5"
          >
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="From" error={errors.startsAt} required>
                <Input
                  name="start"
                  type="time"
                  step={900}
                  defaultValue={draft.start.toTimeString().slice(0, 5)}
                />
              </Field>

              <Field label="To" error={errors.endsAt} required>
                <Input
                  name="end"
                  type="time"
                  step={900}
                  defaultValue={draft.end.toTimeString().slice(0, 5)}
                />
              </Field>
            </div>

            <Field label="Purpose" error={errors.purpose}>
              <Textarea name="purpose" placeholder="Design review" rows={2} />
            </Field>

            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-subtle">
              A booking that ends exactly when another begins is fine — the ranges are half-open,
              so 10:00–11:00 may follow 09:00–10:00.
            </p>
          </form>
        )}
      </Modal>
    </PageShell>
  );
}
