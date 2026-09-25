import { notFound } from "next/navigation";
import { getCurrentUser } from "@/infrastructure/auth/current-user";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") notFound();
  return children;
}
