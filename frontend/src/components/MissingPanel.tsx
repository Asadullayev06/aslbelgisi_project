import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function MissingPanel({
  title, count, preview, emptyMessage,
}: {
  title: string;
  count: number;
  preview: string[];
  emptyMessage: string;
}) {
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
                    className="rounded border border-border bg-surface2/40 px-2 py-0.5
                               font-mono text-[11px] text-text">
                {c}
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
