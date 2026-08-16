import { useState } from "react";
import {
  Sparkles, X, CheckCircle2, AlertTriangle, XCircle, Loader2, Wand2,
} from "lucide-react";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import type { AnalysisResult, AnalysisCheck } from "@/types";

/**
 * The gradient "AI Tahlil" button + result panel.
 *
 * Optional feature — the operator can ignore it. When clicked, it POSTs
 * /api/projects/{id}/analyze and shows a compact drawer with the health
 * verdict, per-check breakdown and recommendations. Styling deliberately
 * borrows the "AI feature" look (purple/pink gradient + sparkles).
 */
export function AiAnalysisButton({ projectId, size = "md" }: {
  projectId: number;
  size?: "sm" | "md";
}) {
  const [open, setOpen]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState<AnalysisResult | null>(null);
  const [err, setErr]         = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setResult(null); setOpen(true);
    try {
      const r = await api.analyzeProject(projectId);
      setResult(r);
    } catch (e: any) {
      setErr(String(e.message || e));
    }
    setBusy(false);
  }

  const sizeCls = size === "sm"
    ? "h-9 px-3 text-xs"
    : "h-11 px-4 text-sm";

  return (
    <>
      <button
        onClick={run}
        title="Loyihaning holatini AI yordamida tahlil qilish"
        className={cn(
          "relative inline-flex items-center gap-2 rounded-xl font-semibold text-white",
          "transition-transform hover:scale-[1.02] active:scale-100 shadow-lg",
          "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-600",
          "hover:from-fuchsia-500 hover:via-violet-500 hover:to-indigo-500",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70",
          sizeCls,
        )}
      >
        {/* subtle glow */}
        <span aria-hidden className="absolute -inset-0.5 rounded-xl bg-gradient-to-r
                                    from-fuchsia-500/40 via-violet-500/40 to-indigo-500/40
                                    blur opacity-60 -z-10" />
        <Sparkles className="size-4" />
        AI Tahlil
      </button>

      {open && (
        <Drawer onClose={() => setOpen(false)}>
          {busy && (
            <div className="flex items-center gap-3 p-8 text-muted">
              <Loader2 className="size-5 animate-spin text-fuchsia-400" />
              AI loyihani tahlil qilmoqda…
            </div>
          )}
          {err && (
            <div className="p-4 rounded-lg border border-danger/40 bg-danger/10 text-sm text-danger">
              {err}
            </div>
          )}
          {result && <ResultView r={result} />}
        </Drawer>
      )}
    </>
  );
}


function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-[640px] h-full overflow-y-auto bg-surface border-l border-border shadow-2xl">
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border
                        px-5 py-3 flex items-center justify-between
                        bg-gradient-to-r from-fuchsia-900/30 via-violet-900/30 to-indigo-900/30">
          <div className="flex items-center gap-2">
            <Wand2 className="size-5 text-fuchsia-400" />
            <div>
              <div className="text-[11px] uppercase tracking-widest text-fuchsia-300/80">AI Tahlil</div>
              <div className="text-sm font-semibold">Loyiha sifat tekshiruvi</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-danger p-1 rounded hover:bg-danger/10">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}


function ResultView({ r }: { r: AnalysisResult }) {
  const headerTone = r.health === "healthy" ? "text-success"
                    : r.health === "warnings" ? "text-warning" : "text-danger";
  const headerBadge = r.health === "healthy" ? "TAYYOR"
                    : r.health === "warnings" ? "OGOHLANTIRISHLAR"
                    : "BLOKLARNI TUZATING";
  const HeadIcon = r.health === "healthy" ? CheckCircle2
                : r.health === "warnings" ? AlertTriangle : XCircle;

  return (
    <div className="flex flex-col gap-4">
      {/* Verdict */}
      <div className="rounded-xl border border-border bg-surface2/40 p-4 flex items-center gap-3">
        <HeadIcon className={cn("size-6", headerTone)} />
        <div className="flex-1">
          <div className={cn("text-lg font-bold", headerTone)}>{headerBadge}</div>
          <div className="text-xs text-muted mt-0.5">
            Yaratilgan: {r.generated_at.replace("T", " ")}
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Jami KM"       value={r.summary.km_total} />
        <Tile label="Yopilgan"      value={r.summary.km_aggregated} tone="success" />
        <Tile label="Qolgan"        value={r.summary.km_pending + r.summary.km_claimed} tone="warning" />
        <Tile label="SSCC yuklangan" value={r.summary.sscc_total} />
        <Tile label="Ishlatilgan"    value={r.summary.sscc_used} tone="accent" />
        <Tile label={`Reja: ${r.summary.full_planned}${r.summary.closed_loose ? "+L" : ""}`}
              value={r.summary.closed_full} />
      </div>

      {/* Checks */}
      <div>
        <div className="text-[11px] uppercase tracking-widest text-muted mb-2 font-semibold">
          Tekshiruvlar ({r.checks.length})
        </div>
        <div className="flex flex-col gap-1.5">
          {r.checks.map((c, i) => <CheckRow key={i} c={c} />)}
        </div>
      </div>

      {/* Recommendations */}
      {r.recommendations.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted mb-2 font-semibold">
            AI tavsiyalari
          </div>
          <div className="rounded-lg border border-fuchsia-500/30
                          bg-gradient-to-br from-fuchsia-900/10 via-violet-900/10 to-indigo-900/10 p-3">
            <ul className="text-sm space-y-1.5">
              {r.recommendations.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <Sparkles className="size-4 text-fuchsia-400 shrink-0 mt-0.5" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}


function CheckRow({ c }: { c: AnalysisCheck }) {
  const style = c.level === "ok"       ? { icon: CheckCircle2,  cls: "text-success", border: "border-success/30", bg: "bg-success/5" }
              : c.level === "warn"     ? { icon: AlertTriangle, cls: "text-warning", border: "border-warning/30", bg: "bg-warning/5" }
              :                          { icon: XCircle,       cls: "text-danger",  border: "border-danger/40",  bg: "bg-danger/10" };
  const Icon = style.icon;
  return (
    <div className={cn("rounded-lg border p-2.5 flex items-start gap-2", style.border, style.bg)}>
      <Icon className={cn("size-4 mt-0.5 shrink-0", style.cls)} />
      <div className="flex-1 text-sm">
        <div className={cn("font-semibold", style.cls)}>{c.title}</div>
        {c.detail && <div className="text-xs text-muted mt-0.5">{c.detail}</div>}
        {c.sample && c.sample.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {c.sample.slice(0, 6).map((s, i) => (
              <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface2/60 text-muted">{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function Tile({ label, value, tone = "text" }: {
  label: string; value: number | string;
  tone?: "text" | "success" | "warning" | "accent";
}) {
  const cls = tone === "success" ? "text-success"
            : tone === "warning" ? "text-warning"
            : tone === "accent"  ? "text-accent"
            : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface2/30 p-2.5">
      <div className={cn("text-xl font-extrabold", cls)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}
