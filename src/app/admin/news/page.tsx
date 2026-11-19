import { AdminShell } from "@/presentation/features/admin/admin-shell";
import { NewsModule } from "@/presentation/features/admin/news-module";
export default function AdminNewsPage() {
  return <AdminShell><NewsModule /></AdminShell>;
}
