"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { API_URL, tokenStore } from "@/lib/api";

type ServerEvent =
  | { type: "connected" }
  | { type: "invalidate"; keys: string[]; message?: string };

/**
 * Live updates, in about forty lines.
 *
 * The server pushes only a hint — `{ type: "invalidate", keys: [...] }` — never
 * data. We hand those keys to TanStack Query, and every screen already subscribed
 * to them refetches through the normal authenticated API.
 *
 * That is why real-time here costs one hook rather than a parallel data layer:
 * no query's shape, permissions, or serialisation is reimplemented for the wire,
 * and a socket that carries no data cannot leak any.
 */
export function useRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let closedByUs = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const token = tokenStore.get();
      if (!token) return;

      const url = `${API_URL.replace(/^http/, "ws")}/ws?token=${token}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setIsConnected(true);
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerEvent;
        if (message.type !== "invalidate") return;

        for (const key of message.keys) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (closedByUs) return;

        /**
         * Exponential backoff, capped at 30s. A fixed 1-second retry would hammer
         * a restarting server with a request per second per open tab — a small
         * self-inflicted denial of service exactly when the server is weakest.
         */
        const delay = Math.min(1000 * 2 ** retryRef.current++, 30_000);
        retryTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      closedByUs = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [enabled, queryClient]);

  return { isConnected };
}
