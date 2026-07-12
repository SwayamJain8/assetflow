"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";

import { AuthProvider } from "@/context/auth";
import { ThemeProvider } from "@/context/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Zero staleTime, because the WebSocket is what decides when data is
             * stale. A timer-based staleTime would fight the invalidation hints:
             * either it refetches when nothing changed, or it holds a cached value
             * the server has already told us to drop.
             */
            staleTime: 0,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // Never retry a 4xx — a 403 will still be a 403 the third time, and
              // retrying just delays the error the user needs to see.
              const status = (error as { status?: number }).status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              },
            }}
          />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
