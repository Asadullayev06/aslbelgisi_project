import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl border border-border bg-surface/70 backdrop-blur-sm",
        "shadow-[0_1px_0_0_hsl(var(--border))] p-5",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export function CardHead({
  title,
  children,
  right,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between mb-4 gap-3", className)}>
      <div>
        <div className="text-[0.72rem] tracking-[0.14em] font-semibold text-muted uppercase">
          {title}
        </div>
        {children && <div className="text-text mt-1">{children}</div>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
