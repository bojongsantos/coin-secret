import "server-only";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
export const adminMutationLimiter = createFixedWindowLimiter({ limit: 30, windowMs: 60_000 });
