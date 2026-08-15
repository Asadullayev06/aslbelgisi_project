import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/**
 * Multi-select as a row of toggleable chips — feels much lighter than a
 * traditional <select multiple>. Selected chips glow accent; unselected
 * are neutral outlines.
 */
export function ChipGroup({
  options, selected, onChange, className,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map(o => {
        const on = selected.includes(o);
        return (
          <button
            type="button"
            key={o}
            onClick={() => toggle(o)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all",
              on
                ? "bg-accent/15 border-accent text-accent shadow-glow"
                : "border-border bg-surface2/40 text-muted hover:border-accent/40 hover:text-text",
            )}
          >
            {on && <Check className="size-3" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}
