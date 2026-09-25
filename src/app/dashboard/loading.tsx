import { AppShell } from "@/presentation/layout/app-shell";

/** Keep the dashboard frame visible while Next prepares the route. */
export default function DashboardLoading() {
  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:gap-5" role="status" aria-label="Loading dashboard">
        <section className="cs-panel p-4 sm:p-5">
          <div className="mb-5 h-6 w-44 animate-pulse rounded bg-surface-3" />
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-72 animate-pulse rounded-2xl border border-border bg-surface" />
            ))}
          </div>
        </section>
        <section className="cs-panel p-4 sm:p-5">
          <div className="mb-5 h-6 w-24 animate-pulse rounded bg-surface-3" />
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((item) => (
              <div key={item} className="h-72 animate-pulse rounded-2xl border border-border bg-surface" />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
