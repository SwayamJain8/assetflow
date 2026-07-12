import type { WSContext } from "hono/ws";

/**
 * Live updates over WebSocket.
 *
 * The design decision that makes this cheap: **the message carries no data.** It
 * is only a hint about what changed:
 *
 *   { "type": "invalidate", "keys": ["assets", "dashboard"] }
 *
 * The client hands those keys to TanStack Query's `invalidateQueries`, and every
 * screen already subscribed to them refetches through the normal, authenticated,
 * role-filtered API path it always uses.
 *
 * Pushing the actual rows down the socket would mean re-implementing every
 * query's shape, its permissions, and its serialisation a second time — and a
 * socket that pushes data is a socket that can leak data to a client whose role
 * changed a moment ago. A pure invalidation signal cannot leak anything, because
 * it contains nothing.
 */

type Socket = { ws: WSContext; userId: string };

/** orgId → the sockets currently open for that organization. */
const rooms = new Map<string, Set<Socket>>();

export type RealtimeEvent = {
  type: "invalidate";
  /** TanStack Query keys to invalidate, e.g. ["assets", "dashboard"]. */
  keys: string[];
  /** Optional: a toast-worthy line, for the notification bell. */
  message?: string;
};

export function join(orgId: string, socket: Socket): void {
  if (!rooms.has(orgId)) rooms.set(orgId, new Set());
  rooms.get(orgId)!.add(socket);
}

export function leave(orgId: string, socket: Socket): void {
  const room = rooms.get(orgId);
  if (!room) return;

  room.delete(socket);

  // Do not leak an empty Set per organization forever.
  if (room.size === 0) rooms.delete(orgId);
}

/**
 * Tell every open client in an organization that something changed.
 *
 * Scoped by orgId, so one tenant's activity never reaches another's browser —
 * the same isolation the queries have, applied to the socket.
 *
 * Never throws: a dead socket must not roll back the business action that
 * triggered the broadcast. A booking that was made is made, even if we failed to
 * tell somebody's browser about it.
 */
export function broadcast(orgId: string, event: RealtimeEvent): void {
  const room = rooms.get(orgId);
  if (!room?.size) return;

  const payload = JSON.stringify(event);

  for (const socket of room) {
    try {
      socket.ws.send(payload);
    } catch {
      // The socket died between the last heartbeat and now. Drop it.
      room.delete(socket);
    }
  }
}

/** Exposed on the health endpoint, so "is realtime actually connected?" is answerable. */
export function connectionCount(): number {
  let total = 0;
  for (const room of rooms.values()) total += room.size;
  return total;
}
