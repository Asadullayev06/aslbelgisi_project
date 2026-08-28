import { useState } from "react";
import { X } from "lucide-react";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function MissingPanel({
  title, count, preview, emptyMessage, onDelete,
}: {
  title: string;
  count: number;
  preview: string[];
  emptyMessage: string;
  /** Admin-only. When present, each pill gets an × that calls this. */
  onDelete?: (code: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function handleDelete(c: string) {
    if (!onDelete || busy) return;
    if (!confirm(`Bu kodni ro'yxatdan o'chiramizmi?\n\n${c}\n\nAmal ortga qaytarilmaydi.`)) return;
    setBusy(c);
    try { await onDelete(c); }
    catch (e: any) { alert(String(e?.message || e)); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHead title={title}
                right={<Badge tone={count ? "warning" : "success"}>{count}</Badge>} />
      {count === 0 ? (
        <div className="text-success text-sm font-semibold">{emptyMessage}</div>
      ) : (
        <>
          <div className="text-muted text-sm mb-2">
            Ro'yxatga yuklangan, lekin hech qaysi qutiga skanerlanmagan kodlar:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {preview.map(c => (
              <span key={c}
                    className="inline-flex items-center gap-1 rounded border border-border bg-surface2/40 pl-2 pr-1 py-0.5
                               font-mono text-[11px] text-text">
                <span>{c}</span>
                {onDelete && (
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={busy === c}
                    title="Kodni ro'yxatdan o'chirish (admin)"
                    className="ml-1 rounded p-0.5 text-muted hover:text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
            {count > preview.length && (
              <span className="text-xs text-muted self-center ml-1">
                …yana {count - preview.length} ta
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
