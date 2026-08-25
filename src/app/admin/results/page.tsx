import { AdminShell } from "@/presentation/features/admin/admin-shell";
import { SetupResultsModule } from "@/presentation/features/admin/setup-results-module";

export default function AdminSetupResultsPage() {
  return (
    <AdminShell>
      <SetupResultsModule />
    </AdminShell>
  );
}
