/**
 * Visual marker used wherever a directive message is rendered.
 * Purely cosmetic; access rules live in ChatService.
 */

"use client";

import { cn } from "@/lib/utils";

export function DirectiveBadge({
  acknowledged,
  className,
}: {
  acknowledged?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        acknowledged
          ? "border-foreground/20 text-foreground/60"
          : "border-crown/60 bg-crown/10 text-crown",
        className,
      )}
      aria-label={acknowledged ? "Приказ выполнен" : "Системный приказ"}
    >
      <span aria-hidden className="text-[10px]">
        {acknowledged ? "✓" : "★"}
      </span>
      {acknowledged ? "Принято" : "Приказ"}
    </span>
  );
}
