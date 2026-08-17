import { useMemo, useState, useRef } from "react";
import {
  ArrowLeft, Search, Download, Upload, Package, ScanLine,
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import type { SearchResponse, SearchRow } from "@/types";
import { cn } from "@/lib/utils";

/** Server-side cap is 5000; this is the client-side sanity cap. */
const MAX_CODES = 5000;

export function CodeSearch({ onExit }: { onExit: () => void }) {
  const [codesText, setCodesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const { flashes, push, dismiss } = useFlashes();

  const codeCount = useMemo(
    () => codesText.split(/\r?\n/).filter(l => l.trim()).length,
    [codesText],
  );

  function collectCodes(): string[] {
    return codesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  async function runSearch() {
    const codes = collectCodes();
    if (codes.length === 0) {
      push("err", "Kod kiriting");
      return;
    }
    if (codes.length > MAX_CODES) {
      push("err", `Bir vaqtda ${MAX_CODES} kodgacha`);
      return;
    }
    setBusy(true);
    setOpen(new Set());
    try {
      const r = await api.searchCodes(codes);
      setResp(r);
      if (r.found === 0) push("warn", "Hech narsa topilmadi");
      else push("hit", `${r.found} / ${r.total} topildi`);
    } catch (e: any) {
      push("err", String(e.message || e));
    }
    setBusy(false);
  }

  async function downloadExcel() {
    const codes = collectCodes();
    if (codes.length === 0) {
      push("err", "Kod kiriting");
      return;
    }
    if (codes.length > MAX_CODES) {
      push("err", `Bir vaqtda ${MAX_CODES} kodgacha`);
      return;
    }
    setExporting(true);
    try {
      const blob = await api.searchExport(codes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `qidiruv-${ts}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      push("hit", "Excel yuklab olindi");
    } catch (e: any) {
      push("err", String(e.message || e));
    }
    setExporting(false);
  }

  async function loadFile(file: File) {
    try {
      // Backend parser already handles CSV/TSV/XLSX; reuse it.
      const res = await api.customParseKm(file, false);
      const existing = new Set(collectCodes());
      const merged = [...existing];
      for (const c of res.codes) if (!existing.has(c)) merged.push(c);
      setCodesText(merged.join("\n"));
      push("hit", `${res.codes.length} kod fayldan qo'shildi`);
    } catch (e: any) {
      push("err", String(e.message || e));
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <button onClick={onExit}
                className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Bosh sahifa
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent">
            Kod Qidiruv
          </div>
          <div className="text-muted text-sm">
            Ichki bazadan qidirish — faqat Asl Belgisi ga yuborilgan loyihalar
          </div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHead
          title="Qidiruv"
          right={
            <>
              <Badge tone={codeCount ? "accent" : "neutral"}>
                {codeCount} kod
              </Badge>
              <Button variant="outline" size="sm"
                      onClick={() => fileRef.current?.click()}>
                <Upload className="size-3" /> Fayl
              </Button>
              <input type="file" hidden ref={fileRef}
                     accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
                     onChange={e => {
                       const f = e.target.files?.[0];
                       if (f) loadFile(f);
                       e.currentTarget.value = "";
                     }} />
            </>
          }
        />
        <Field label="KM yoki quti (SSCC) kodlari — har qatorga bittadan"
               hint="Ko'p kodni birdaniga qo'yishingiz mumkin; noto'g'ri va topilmagan kodlar javobda alohida ko'rsatiladi.">
          <Textarea rows={7} value={codesText}
                    onChange={e => setCodesText(e.target.value)}
                    placeholder="0108033661809165217xxxxxxxxxxxx&#10;00090003247210060105" />
        </Field>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Button variant="primary" onClick={runSearch}
                  disabled={busy || codeCount === 0}>
            <Search className="size-4" />
            {busy ? "Qidirilmoqda…" : "Qidirish"}
          </Button>
          <Button variant="outline" onClick={downloadExcel}
                  disabled={exporting || codeCount === 0}>
            <Download className="size-4" />
            {exporting ? "Tayyorlanmoqda…" : "Excel"}
          </Button>
          {resp && (
            <div className="ml-auto text-sm text-muted self-center">
              Topildi: <b className="text-success">{resp.found}</b>{" "}
              / {resp.total}
              {resp.total - resp.found > 0 && (
                <>
                  {" · "}
                  <b className="text-danger">{resp.total - resp.found}</b>{" "}
                  topilmadi
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      {resp && (
        <Card>
          <CardHead title="Natijalar"
                    right={<Badge tone="neutral">{resp.total}</Badge>} />
          {resp.results.length === 0 && (
            <div className="text-muted italic text-sm p-4 text-center">
              Natijalar yo'q
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {resp.results.map((r, i) => (
              <ResultRow key={i} idx={i} row={r}
                         isOpen={open.has(i)}
                         onToggle={() => setOpen(s => {
                           const n = new Set(s);
                           n.has(i) ? n.delete(i) : n.add(i);
                           return n;
                         })} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}


function ResultRow({ row, idx, isOpen, onToggle }: {
  row: SearchRow; idx: number; isOpen: boolean; onToggle: () => void;
}) {
  const found = row.found;
  const canExpand = found && (row.kind === "sscc" ? row.km_codes.length > 0 : true);

  return (
    <div className={cn(
      "rounded-lg border overflow-hidden",
      found ? "border-border" : "border-danger/30 bg-danger/5",
    )}>
      <button
        className="flex items-center justify-between gap-3 w-full px-3 py-2 text-left
                   hover:bg-surface2/40 disabled:cursor-default"
        onClick={onToggle}
        disabled={!canExpand}
      >
        <div className="flex items-center gap-2 min-w-0">
          {canExpand
            ? (isOpen ? <ChevronDown className="size-4 shrink-0" />
                      : <ChevronRight className="size-4 shrink-0" />)
            : <span className="size-4 shrink-0" />}
          {found
            ? <CheckCircle2 className="size-4 text-success shrink-0" />
            : <XCircle className="size-4 text-danger shrink-0" />}
          {row.kind === "km"
            ? <ScanLine className="size-4 text-accent shrink-0" />
            : row.kind === "sscc"
              ? <Package className="size-4 text-accent shrink-0" />
              : <span />}
          <span className="text-xs text-muted shrink-0">#{idx + 1}</span>
          <span className="font-mono text-xs break-all">{row.raw}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {row.kind !== "unknown" && (
            <Badge tone={found ? "accent" : "neutral"}>
              {row.kind === "km" ? "KM" : "SSCC"}
            </Badge>
          )}
          {row.kind === "sscc" && found && (
            <Badge tone="accent">{row.km_count} ta</Badge>
          )}
          {!found && (
            <span className="text-xs text-danger">topilmadi</span>
          )}
        </div>
      </button>

      {isOpen && found && (
        <div className="border-t border-border p-3 space-y-2 bg-surface2/20">
          {row.project && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <KV label="Loyiha"   value={row.project.name} />
              <KV label="Mahsulot" value={row.project.product_name} />
              <KV label="Seriya"   value={row.project.series || "—"} accent />
              {row.box && (
                <KV label={"Quti (SSCC)" + (row.box.is_loose ? " · LOOSE" : "")}
                    value={row.box.sscc} mono />
              )}
            </div>
          )}
          {row.kind === "sscc" && row.km_codes.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted mb-1">
                Ichidagi KM kodlar ({row.km_codes.length})
              </div>
              <div className="rounded border border-border bg-surface2/40 max-h-64 overflow-auto">
                <ul className="divide-y divide-border">
                  {row.km_codes.map(km => (
                    <li key={km} className="px-2 py-1 font-mono text-xs break-all">
                      {km}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {row.kind === "km" && row.km_status && (
            <div className="text-xs text-muted">
              Holat: <b className="text-text">{row.km_status}</b>
              {row.box?.closed_at && (
                <> · Yopilgan: <b className="text-text">
                  {new Date(row.box.closed_at).toLocaleString()}</b></>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function KV({ label, value, mono, accent }: {
  label: string; value: string; mono?: boolean; accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={cn(
        "text-sm truncate",
        mono && "font-mono",
        accent && "text-accent font-semibold",
      )}>{value}</div>
    </div>
  );
}
