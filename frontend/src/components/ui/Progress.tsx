import { cn } from "@/lib/utils";

export function Progress({
  value, max = 100, className, tone = "accent",
}: { value: number; max?: number; className?: string; tone?: "accent" | "warning" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = tone === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className={cn("h-2 w-full rounded-full bg-surface2", className)}>
      <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
