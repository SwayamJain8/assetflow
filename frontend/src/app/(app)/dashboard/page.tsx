"use client";

import { PageShell } from "@/components/layout/page-shell";
import { useAuth } from "@/context/auth";

/** Placeholder — the real dashboard lands in the next phase. */
export default function DashboardPage() {
  const { user, organization } = useAuth();

  return (
    <PageShell title="Dashboard" subtitle="Today's overview">
      <div className="card p-6">
        <p className="text-sm text-fg">
          Signed in as <span className="font-medium">{user?.name}</span> ({user?.role}) at{" "}
          <span className="font-medium">{organization?.name}</span>.
        </p>
        <p className="mt-2 text-xs text-muted">The dashboard is built in the next phase.</p>
      </div>
    </PageShell>
  );
}
