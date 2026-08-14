import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
  {
    variants: {
      tone: {
        accent:  "bg-accent/15 text-accent",
        warning: "bg-warning/15 text-warning",
        danger:  "bg-danger/15 text-danger",
        success: "bg-success/15 text-success",
        neutral: "bg-surface2 text-muted",
        loose:   "bg-warning/15 text-warning border border-dashed border-warning",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
