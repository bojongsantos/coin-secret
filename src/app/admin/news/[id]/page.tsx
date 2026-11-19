import { AdminShell } from "@/presentation/features/admin/admin-shell";
import { NewsEditor } from "@/presentation/features/admin/news-editor";
export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  return <AdminShell><NewsEditor id={(await params).id} /></AdminShell>;
}
