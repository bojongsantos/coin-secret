"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { type FeatureKey } from "@/core/domain/access/gating";
import { useT } from "@/presentation/hooks/use-translate";
import { domainMessageKey } from "@/shared/i18n/messages";

interface LockedOverlayProps {
  feature: FeatureKey;
  locked?: boolean;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}

export function LockedOverlay({ feature, locked, children, className, overlayClassName }: LockedOverlayProps) {
  const { canAccess } = usePlan();
  const { t } = useT();
  const isLocked = locked ?? !canAccess(feature);
  const featureKey = domainMessageKey("feature", feature);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        className={isLocked ? "pointer-events-none select-none blur-[7px]" : undefined}
        aria-hidden={isLocked || undefined}
      >
        {children}
      </div>
      {isLocked && (
        <div
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/55 backdrop-blur-[1.5px] ${overlayClassName ?? ""}`}
        >
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-2">
              <Lock className="size-3" /> {t("common.premium")}
            </span>
            <p className="max-w-[220px] text-[11px] leading-snug text-muted">{featureKey ? t(featureKey) : feature}</p>
          </div>
            <Link
              href="/account"
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-accent to-accent-blue px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Lock className="size-3.5" />
              {t("common.upgrade")}
            </Link>
        </div>
      )}
    </div>
  );
}
