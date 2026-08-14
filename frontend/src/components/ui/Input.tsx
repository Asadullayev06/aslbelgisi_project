import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-lg border border-border bg-surface2/50 px-3 py-2 text-sm text-text",
        "placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "font-mono",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-24 w-full rounded-lg border border-border bg-surface2/50 px-3 py-2 text-sm text-text",
      "placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "font-mono",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
