"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "@/presentation/hooks/use-translate";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordField({ className = "", ...props }: Props) {
  const [revealed, setRevealed] = useState(false);
  const { t } = useT();

  return (
    <div className="relative">
      <input {...props} type={revealed ? "text" : "password"} className={`${className} pr-12`} />
      <button
        type="button"
        aria-label={t("auth.holdToViewPassword")}
        title={t("auth.holdToViewPassword")}
        aria-pressed={revealed}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setRevealed(true);
        }}
        onPointerUp={() => setRevealed(false)}
        onPointerCancel={() => setRevealed(false)}
        onLostPointerCapture={() => setRevealed(false)}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") setRevealed(true);
        }}
        onKeyUp={() => setRevealed(false)}
        onBlur={() => setRevealed(false)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
      >
        {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
