import { db } from "../config/db";
import { activityLogs, notifications } from "../db/schema";
import type { notificationType } from "../db/schema";
import type { Ctx } from "../types";

type NotificationType = (typeof notificationType.enumValues)[number];

export type RecordInput = {
  /** 'asset' | 'allocation' | 'booking' | 'maintenance' | 'audit' | 'department' | … */
  entity: string;
  entityId?: string;
  /** 'registered' | 'allocated' | 'returned' | 'maintenance_approved' | … */
  action: string;
  /** The line a human reads: "Laptop AF-0114 allocated to Priya Sharma". */
  summary: string;
  metadata?: Record<string, unknown>;

  /** Optional: also notify someone. */
  notify?: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    link?: string;
  };
};

/**
 * The single side-effect helper every mutation calls.
 *
 * One call writes the activity log AND (optionally) a notification, so three
 * separate features light up from one line at each call site:
 *
 *   • the Activity Log screen           (all rows for the org)
 *   • the Dashboard's "Recent Activity" (the newest few)
 *   • the per-asset LIFECYCLE TIMELINE  (rows for one entity_id, in order)
 *
 * The timeline is therefore not a feature to maintain — it is a query over the
 * history we were already recording. Phase 11 adds a WebSocket broadcast here,
 * which will make every one of those views live without touching a call site.
 *
 * Deliberately never throws: an audit-trail failure must not roll back the
 * business action that succeeded. A booking that got made is made, even if we
 * failed to write the log line about it.
 */
export async function record(ctx: Ctx, input: RecordInput): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      organizationId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: input.entity,
      entityId: input.entityId ?? null,
      action: input.action,
      summary: input.summary,
      metadata: input.metadata ?? {},
    });

    if (input.notify) {
      await db.insert(notifications).values({
        organizationId: ctx.orgId,
        userId: input.notify.userId,
        type: input.notify.type,
        title: input.notify.title,
        body: input.notify.body ?? null,
        link: input.notify.link ?? null,
      });
    }
  } catch (error) {
    console.error("Failed to record activity:", error);
  }
}
