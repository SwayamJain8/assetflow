"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/context/auth";

/**
 * The gate for every signed-in screen.
 *
 * This is a convenience, not the security boundary — the real enforcement is the
 * backend's requireAuth/requireRole on every endpoint. A user who forced their way
 * past this component would see an empty shell and a wall of 401s, because the
 * client holds no data of its own.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg">
        <div className="flex items-center gap-2.5 text-muted">
          <div className="grid size-8 animate-pulse place-items-center rounded-md bg-primary text-xs font-bold text-white">
            AF
          </div>
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
