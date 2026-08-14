import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium " +
    "transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
    "disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-black hover:brightness-110 shadow-glow",
        secondary:
          "bg-surface2 text-text border border-border hover:bg-surface2/70",
        outline:
          "border border-border bg-transparent text-text hover:bg-surface2/60",
        ghost:
          "bg-transparent text-text hover:bg-surface2/60",
        danger:
          "border border-danger/60 text-danger bg-transparent hover:bg-danger/10",
        warning:
          "bg-warning text-black hover:brightness-110",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-5 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
