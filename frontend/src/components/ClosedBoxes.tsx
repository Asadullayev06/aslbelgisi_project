import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2, PackageOpen } from "lucide-react";
import type { ClosedBox } from "@/types";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export function ClosedBoxes({
  boxes, onDelete,
}: {
  boxes: ClosedBox[];
  /** Omit to hide the delete button (used for non-admin viewers). */
  onDelete?: (boxId: number) => void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <Card>
      <CardHead
        title="Yopilgan qutilar"
        right={<Badge tone={boxes.length ? "accent" : "neutral"}>{boxes.length}</Badge>}
      />
      {boxes.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-5 text-center text-muted italic text-sm">
          Hali birorta quti yopilmagan
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {boxes.map((b, i) => {
          const isOpen = open.has(b.id);
          return (
            <div key={b.id}
                 className={cn(
                   "rounded-lg border border-border overflow-hidden",
                   b.is_loose && "border-warning/50 bg-warning/5",
                 )}>
              <button
                className="flex items-center justify-between gap-3 w-full px-3 py-2 text-left hover:bg-surface2/40"
                onClick={() => setOpen(s => {
                  const n = new Set(s); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n;
                })}>
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  <PackageOpen className={cn("size-4", b.is_loose ? "text-warning" : "text-accent")} />
                  <span className="text-sm">
                    Quti {i + 1}{b.is_loose && <span className="text-warning ml-1">(LOOSE)</span>}
                  </span>
                  <span className="font-mono text-xs text-muted">· {b.sscc}</span>
                </div>
                <Badge tone={b.is_loose ? "loose" : "accent"}>{b.codes_count} ta</Badge>
              </button>
              {isOpen && onDelete && (
                <div className="border-t border-border p-3 flex justify-end">
                  <Button variant="danger" size="sm" onClick={() => onDelete(b.id)}>
                    <Trash2 className="size-3" /> Qutini bekor qilish
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
