import { redirect } from "next/navigation";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { AccountModule } from "@/presentation/features/account/account-module";
import { AppShell } from "@/presentation/layout/app-shell";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");
  return <AppShell><AccountModule user={user} /></AppShell>;
}
