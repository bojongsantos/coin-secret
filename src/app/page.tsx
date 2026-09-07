import { redirect } from "next/navigation";
import { LandingPage } from "@/presentation/features/landing/landing-page";
import { getCurrentUser } from "@/infrastructure/auth/current-user";

export const dynamic = "force-dynamic";

/**
 * The root, which is two different things depending on who is asking.
 *
 * A visitor who has never signed in gets the landing page; someone with a
 * session gets the board they came for, without a marketing page in the way.
 * Signed-in readers keep every bookmark they had, because "/" still ends at
 * the dashboard for them.
 */
export default async function HomePage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");
  return <LandingPage />;
}
