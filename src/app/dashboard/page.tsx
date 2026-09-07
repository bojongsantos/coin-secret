import { DashboardClient } from "@/presentation/features/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

/**
 * The app itself.
 *
 * Given its own address so the landing page has somewhere stable to send a
 * visitor, and so a reader who is not signed in can still reach the board —
 * the product has always been usable without an account.
 */
export default function DashboardPage() {
  return <DashboardClient />;
}
