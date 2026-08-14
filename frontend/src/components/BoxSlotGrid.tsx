import { cn } from "@/lib/utils";

/** Big box-level kubik row: full boxes numbered 1..N, then an optional
 *  dashed-amber `L` slot for the loose box. */
export function BoxSlotGrid({
  fullPlanned, fullClosed, hasLoose, looseClosed, currentIsLoose,
}: {
  fullPlanned: number;
  fullClosed: number;
  hasLoose: boolean;
  looseClosed: boolean;
  currentIsLoose: boolean;
}) {
  const cells: JSX.Element[] = [];
  for (let i = 0; i < fullPlanned; i++) {
    const filled  = i < fullClosed;
    const current = !currentIsLoose && i === fullClosed;
    cells.push(
      <div key={i}
           title={`Quti ${i + 1}`}
           className={cn(
             "flex items-center justify-center rounded-md border text-[10px] font-bold",
             "size-6 shrink-0 transition-all",
             filled
               ? "bg-accent text-black border-accent shadow-glow"
               : current
                 ? "border-accent text-accent border-2 animate-pulseSlot"
                 : "border-border bg-surface2/40 text-muted",
           )}>
        {i + 1}
      </div>,
    );
  }
  if (hasLoose) {
    cells.push(
      <div key="loose"
           title="Loose paket"
           className={cn(
             "flex items-center justify-center rounded-md text-[10px] font-bold size-6 shrink-0",
             "border-2 border-dashed transition-all",
             looseClosed
               ? "bg-warning text-black border-solid border-warning"
               : currentIsLoose
                 ? "border-warning text-warning animate-pulseSlot"
                 : "border-warning/60 text-warning/70 bg-warning/5",
           )}>
        L
      </div>,
    );
  }
  return <div className="flex flex-wrap gap-1.5">{cells}</div>;
}
