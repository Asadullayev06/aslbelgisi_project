import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Trash2, PackageOpen, X } from "lucide-react";
import type { BoxCode, BoxContents, ClosedBox } from "@/types";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export function ClosedBoxes({
  boxes, onDelete, onFetchContents, onRemoveCode,
}: {
  boxes: ClosedBox[];
  /** Omit to hide the delete button (used for non-admin viewers). */
  onDelete?: (boxId: number) => void;
  /** Loader for the code list shown when a box row expands. Available to
   *  everyone; the per-code × below is admin-only. */
  onFetchContents?: (boxId: number) => Promise<BoxContents>;
  /** Admin-only: pluck one KM out of this box; it returns to the pool. */
  onRemoveCode?: (boxId: number, kmCode: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [contents, setContents] = useState<Map<number, BoxContents>>(new Map());
  const [loading, setLoading]   = useState<Set<number>>(new Set());
  const [errors, setErrors]     = useState<Map<number, string>>(new Map());
  const [busyCode, setBusyCode] = useState<string | null>(null);

  // Whenever a box the user has expanded changes its codes_count (e.g. after
  // a scan lands elsewhere, or after a code is removed here), refresh its
  // cached contents so the list stays in sync.
  useEffect(() => {
    if (!onFetchContents) return;
    for (const b of boxes) {
      if (!open.has(b.id)) continue;
      const cached = contents.get(b.id);
      if (cached && cached.codes_count === b.codes_count) continue;
      loadContents(b.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, open]);

  async function loadContents(boxId: number) {
    if (!onFetchContents) return;
    setLoading(s => new Set(s).add(boxId));
    setErrors(m => { const n = new Map(m); n.delete(boxId); return n; });
    try {
      const c = await onFetchContents(boxId);
      setContents(m => new Map(m).set(boxId, c));
    } catch (e: any) {
      setErrors(m => new Map(m).set(boxId, String(e?.message || e)));
    } finally {
      setLoading(s => { const n = new Set(s); n.delete(boxId); return n; });
    }
  }

  function toggle(boxId: number) {
    setOpen(s => {
      const n = new Set(s);
      if (n.has(boxId)) n.delete(boxId);
      else { n.add(boxId); if (!contents.has(boxId)) loadContents(boxId); }
      return n;
    });
  }

  async function removeCode(boxId: number, kmCode: string) {
    if (!onRemoveCode || busyCode) return;
    if (!confirm(`Bu kodni qutidan olamizmi?\n\n${kmCode}\n\nKod ro'yxatga qaytadi — istagan paytda boshqa qutiga skanerlash mumkin.`)) return;
    setBusyCode(kmCode);
    try {
      await onRemoveCode(boxId, kmCode);
      // Parent's onRemoveCode is expected to refresh state (which triggers
      // our useEffect to reload contents), but if it doesn't touch state we
      // still refresh this box locally.
      await loadContents(boxId);
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setBusyCode(null);
    }
  }

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
          const c = contents.get(b.id);
          const isLoading = loading.has(b.id);
          const err = errors.get(b.id);
          return (
            <div key={b.id}
                 className={cn(
                   "rounded-lg border border-border overflow-hidden",
                   b.is_loose && "border-warning/50 bg-warning/5",
                 )}>
              <button
                className="flex items-center justify-between gap-3 w-full px-3 py-2 text-left hover:bg-surface2/40"
                onClick={() => toggle(b.id)}>
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
              {isOpen && (
                <div className="border-t border-border">
                  {onFetchContents && (
                    <div className="p-3">
                      {isLoading && !c && (
                        <div className="text-xs text-muted italic">Kodlar yuklanmoqda…</div>
                      )}
                      {err && (
                        <div className="text-xs text-danger">Yuklab bo'lmadi: {err}</div>
                      )}
                      {c && (
                        <div className="flex flex-col gap-2">
                          <CodeList label="Kodlar" codes={c.matched}
                                    boxId={b.id} onRemove={onRemoveCode ? removeCode : undefined}
                                    busyCode={busyCode} />
                          {c.extras.length > 0 && (
                            <CodeList label="Ekstra kodlar (rejadan tashqari)" codes={c.extras}
                                      boxId={b.id} onRemove={onRemoveCode ? removeCode : undefined}
                                      busyCode={busyCode} tone="warning" />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {onDelete && (
                    <div className="border-t border-border p-3 flex justify-end">
                      <Button variant="danger" size="sm" onClick={() => onDelete(b.id)}>
                        <Trash2 className="size-3" /> Qutini bekor qilish
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CodeList({ label, codes, boxId, onRemove, busyCode, tone = "accent" }: {
  label: string;
  codes: BoxCode[];
  boxId: number;
  onRemove?: (boxId: number, kmCode: string) => Promise<void>;
  busyCode: string | null;
  tone?: "accent" | "warning";
}) {
  if (codes.length === 0) return null;
  return (
    <div>
      <div className={cn(
        "text-[11px] uppercase tracking-wide font-semibold mb-1",
        tone === "warning" ? "text-warning" : "text-muted",
      )}>
        {label} · {codes.length}
      </div>
      <div className="flex flex-wrap gap-1">
        {codes.map(item => (
          <span key={item.km_code}
                className="inline-flex items-center gap-1 rounded border border-border bg-surface2/40 pl-2 pr-1 py-0.5
                           font-mono text-[11px] text-text">
            <span>{item.km_code}</span>
            {onRemove && (
              <button
                onClick={() => onRemove(boxId, item.km_code)}
                disabled={busyCode === item.km_code}
                title="Kodni qutidan olib tashlash (admin)"
                className="ml-1 rounded p-0.5 text-muted hover:text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
