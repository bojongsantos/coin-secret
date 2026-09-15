import { redirect } from "next/navigation";

/**
 * The board moved to `/signals`, which is what the interface calls it.
 * Kept so links and bookmarks that predate the rename still land somewhere.
 */
export default function PatternsPage() {
  redirect("/signals");
}
