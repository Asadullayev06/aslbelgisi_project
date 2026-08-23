import { useRef, useState } from "react";
import {
  ArrowLeft, Upload, Download, Printer, FileText, AlertTriangle, Info,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";

interface Props { onExit: () => void; }

type PreviewInfo = {
  total: number;
  first: string[];
  short_count: number;
  short_sample: [number, string][];
};

export function BarTenderCsv({ onExit }: Props) {
  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<PreviewInfo | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { flashes, push, dismiss } = useFlashes();

  async function chooseFile(f: File) {
    setFile(f);
    setPreview(null);
    setPreviewing(true);
    try {
      const p = await api.bartenderPreview(f);
      setPreview(p);
      push("hit", `${p.total} ta kod topildi`);
    } catch (e: any) { push("err", String(e.message || e)); }
    setPreviewing(false);
  }

  async function download() {
    if (!file) return;
    setGenerating(true);
    try {
      const blob = await api.bartenderGenerate(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `BarTender_${stamp}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      push("hit", "CSV yuklab olindi");
    } catch (e: any) { push("err", String(e.message || e)); }
    setGenerating(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <button onClick={onExit}
                className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Bosh sahifa
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent">
            BarTender CSV
          </div>
          <div className="text-muted text-sm">
            KM kodlarni printerga tayyor CSV formatga aylantirish
          </div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHead
          title="Manba fayl"
          right={
            <Badge tone="accent">
              <Printer className="size-3" /> BarTender uchun CSV
            </Badge>
          }
        />

        <div className="text-sm text-muted mb-4">
          .xlsx yoki .csv fayl yuklang. Chiqishda 5 ta ustun bo'ladi
          (A: to'liq kod, B: birinchi 31 belgi, C: 17–31 belgi, D: bo'sh,
          E: <b className="text-text">tartib raqam va umumiy soni</b> —
          masalan <span className="font-mono">1-450, 2-450, … 450-450</span>).
          <span className="block mt-1 text-muted/80">Karobka ajratuvchi qatorlar qo'shilmaydi.</span>
        </div>

        {/* Drop / choose zone */}
        <div
          onDragOver={e => { e.preventDefault(); }}
          onDrop={e => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) chooseFile(f);
          }}
          className="rounded-xl border-2 border-dashed border-border bg-surface2/40 p-8 text-center
                     hover:border-accent/60 transition-colors"
        >
          <FileText className="size-10 text-muted mx-auto mb-2" />
          <div className="text-sm text-muted">
            Faylni bu yerga tashlang yoki
          </div>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3" /> Fayl tanlash
            </Button>
            <input type="file" hidden ref={fileRef}
                   accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
                   onChange={e => {
                     const f = e.target.files?.[0];
                     if (f) chooseFile(f);
                     e.currentTarget.value = "";
                   }} />
          </div>
          {file && (
            <div className="mt-3 text-xs text-muted">
              <span className="font-mono">{file.name}</span> · {(file.size / 1024).toFixed(1)} KB
            </div>
          )}
        </div>
      </Card>

      {previewing && (
        <Card className="mb-4">
          <div className="text-muted text-sm py-2 text-center">Yuklanmoqda…</div>
        </Card>
      )}

      {preview && !previewing && (
        <>
          <Card className="mb-4">
            <CardHead
              title="Ko'rib chiqish"
              right={<Badge tone="accent">{preview.total} ta kod</Badge>}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <StatCard label="Umumiy kod" value={preview.total.toLocaleString()} tone="accent" />
              <StatCard label="Chiqish qatorlari" value={preview.total.toLocaleString()} tone="success" />
              <StatCard label="Qisqa kod (<31)" value={preview.short_count}
                        tone={preview.short_count ? "warning" : "text"} />
            </div>

            <div className="text-xs uppercase tracking-widest text-muted mb-2">Birinchi kodlar</div>
            <div className="rounded-lg border border-border bg-surface2/40 max-h-56 overflow-auto">
              <ul className="divide-y divide-border">
                {preview.first.map((c, i) => (
                  <li key={i} className="px-3 py-1.5 flex items-center gap-3">
                    <span className="text-xs text-muted w-6 shrink-0">{i + 1}</span>
                    <span className="font-mono text-xs break-all">{c}</span>
                  </li>
                ))}
              </ul>
            </div>

            {preview.short_sample.length > 0 && (
              <div className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <div className="flex items-center gap-2 text-warning text-sm font-semibold mb-2">
                  <AlertTriangle className="size-4" />
                  {preview.short_count} ta kod 31 belgidan qisqa
                </div>
                <div className="text-xs text-muted mb-2">
                  Ular baribir chiqish CSV ga qo'shiladi, lekin B/C ustunlari qisqa bo'ladi.
                </div>
                <div className="max-h-32 overflow-auto rounded border border-border bg-surface2/40">
                  <ul className="divide-y divide-border">
                    {preview.short_sample.map(([n, c]) => (
                      <li key={n} className="px-2 py-1 text-xs flex items-center gap-2">
                        <span className="text-muted">#{n}</span>
                        <span className="font-mono break-all">{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <Button variant="primary" size="lg" className="w-full mt-4"
                    onClick={download} disabled={generating}>
              <Download className="size-4" />
              {generating ? "Tayyorlanmoqda…" : "BarTender CSV ni yuklab olish"}
            </Button>
          </Card>
        </>
      )}

      {!file && !previewing && (
        <div className="mt-2 rounded-lg border border-border bg-surface2/40 p-3 text-xs text-muted flex items-start gap-2">
          <Info className="size-4 mt-0.5 shrink-0" />
          <div>
            E ustun format: <span className="font-mono">1-450, 2-450, …, 450-450</span> — umumiy son fayl hajmiga qarab avtomatik hisoblanadi.
          </div>
        </div>
      )}
    </div>
  );
}


function StatCard({ label, value, tone }: {
  label: string; value: string | number;
  tone: "text" | "accent" | "success" | "warning";
}) {
  const cls = tone === "accent"  ? "text-accent"
            : tone === "success" ? "text-success"
            : tone === "warning" ? "text-warning"
            : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={`text-2xl font-extrabold ${cls}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}
