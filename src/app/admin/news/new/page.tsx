import { AdminShell } from "@/presentation/features/admin/admin-shell";
import { NewsEditor } from "@/presentation/features/admin/news-editor";
export default function NewArticlePage() {
  return <AdminShell><NewsEditor /></AdminShell>;
}
