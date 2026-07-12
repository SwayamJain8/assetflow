"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/context/auth";

/** Send people where they belong: the dashboard if signed in, login if not. */
export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [user, isLoading, router]);

  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <div className="flex items-center gap-2.5 text-muted">
        <div className="grid size-8 animate-pulse place-items-center rounded-md bg-primary text-xs font-bold text-white">
          AF
        </div>
        <span className="text-sm">Loading AssetFlow…</span>
      </div>
    </div>
  );
}
