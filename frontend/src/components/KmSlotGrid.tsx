import { cn } from "@/lib/utils";

/** Small per-box KM slot grid (12×12px squares). */
export function KmSlotGrid({
  filled, capacity, tone = "accent",
}: {
  filled: number;
  capacity: number;
  tone?: "accent" | "warning";
}) {
  const slots: JSX.Element[] = [];
  const barFilled = tone === "warning" ? "bg-warning border-warning" : "bg-accent border-accent";
  const barCurrent = tone === "warning" ? "border-warning" : "border-accent";
  for (let i = 0; i < capacity; i++) {
    if (i < filled) {
      slots.push(<div key={i}
        className={cn("size-3 rounded-[3px] border", barFilled)} />);
    } else if (i === filled) {
      slots.push(<div key={i}
        className={cn("size-3 rounded-[3px] border-[1.5px] bg-transparent", barCurrent)} />);
    } else {
      slots.push(<div key={i}
        className="size-3 rounded-[3px] border border-border bg-surface2/40" />);
    }
  }
  return <div className="flex flex-wrap gap-[3px]">{slots}</div>;
}
