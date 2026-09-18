import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, AlertTriangle, X, Trash2, Download, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { ScanInput, type ScanInputHandle } from "@/components/ScanInput";
import { api } from "@/api";
import { useAuth, isAdmin } from "@/auth";
import type { ReportState, ReportScanRow } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  projectId: number;
  onExit: () => void;
}

const MAX_BATCH = 200;
const MAX_ATTEMPTS = 40;
const MAX_HOLD_MS = 30 * 60 * 1000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const backoffMs = (a: number) => Math.min(500 * 2 ** (a - 1), 10000);

type QItem = { code: string; recovered?: boolean };

/** Reporting scan page: one flat list of KM + SSCC codes, dedup within THIS
 *  series is the only rule. Queue plumbing mirrors ScanInventory so a fast
 *  operator never loses a barcode. */
export function ScanReporting({ projectId, onExit }: Props) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [state, setState] = useState<ReportState | null>(null);
  const [projectMeta, setProjectMeta] = useState<{ name: string; product_name: string; series: string; report_kind: "km" | "sscc" | "mixed" } | null>(null);
  const [loadingErr, setLoadingErr] = useState<string | null>(null);
  const { flashes, push, dismiss } = useFlashes();
  const scannerRef = useRef<ScanInputHandle>(null);

  const queueRef = useRef<QItem[]>([]);
  const drainingRef = useRef(false);
  const lastAppliedRef = useRef(Date.now());
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine);
  const [stalled, setStalled] = useState(false);

  type Alert = { code: string; reason: string; kind: "duplicate" | "unknown" };
  const [alert, setAlert] = useState<Alert | null>(null);

  const [rejects, setRejects] = useState<{ code: string; reason: string }[]>([]);
  const [exporting, setExporting] = useState(false);

  const applyState = useCallback((s: ReportState) => {
    setState(s);
    lastAppliedRef.current = Date.now();
  }, []);

  // ── queue persistence (per project + user) ─────────────────
  const storageKey = `mav2.repq.${projectId}.${user?.id ?? "anon"}`;
  const persistQueue = useCallback(() => {
    try {
      const codes = queueRef.current.map(i => i.code);
      if (codes.length) localStorage.setItem(storageKey, JSON.stringify(codes));
      else localStorage.removeItem(storageKey);
    } catch { /* ignore */ }
  }, [storageKey]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (queueRef.current.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ── project meta from the general project endpoint (name/product/series) ──
  useEffect(() => {
    let alive = true;
    api.getProject(projectId)
      .then(s => {
        if (!alive) return;
        setProjectMeta({
          name: s.project.name,
          product_name: s.project.product_name,
          series: s.project.series || "",
          report_kind: ((s.project as any).report_kind || "sscc") as "km" | "sscc" | "mixed",
        });
      })
      .catch(e => { if (alive) setLoadingErr(String(e)); });
    return () => { alive = false; };
  }, [projectId]);

  // Adaptive poll of the reporting-specific state.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (force = false) => {
      if (!force && drainingRef.current) return;
      if (!force && typeof navigator !== "undefined" && !navigator.onLine) return;
      const startedAt = Date.now();
      api.reportingGet(projectId)
        .then(s => {
          if (!alive) return;
          if (!force && lastAppliedRef.current > startedAt) return;
          setState(s);
        })
        .catch(e => { if (alive) setLoadingErr(String(e)); });
    };
    const nextDelay = () => {
      if (typeof document !== "undefined" && document.hidden) return 30000;
      const idleFor = Date.now() - lastAppliedRef.current;
      return idleFor > 30000 ? 8000 : 2000;
    };
    const tick = () => {
      timer = setTimeout(() => { if (alive) { load(); tick(); } }, nextDelay());
    };
    load(true); tick();
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [projectId]);

  const drain = useCallback<() => Promise<void>>(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length) {
        const head = queueRef.current[0];
        const isRecovered = !!head.recovered;
        const items: QItem[] = [];
        for (const it of queueRef.current) {
          if (!!it.recovered !== isRecovered || items.length >= MAX_BATCH) break;
          items.push(it);
        }
        const batch = items.map(i => i.code);
        let settled = false;
        let attempt = 0;
        const startedAt = Date.now();

        while (!settled) {
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            if (Date.now() - startedAt > MAX_HOLD_MS) {
              const reason = "ulanish yo'q — juda uzoq kutildi";
              push("err", reason);
              setRejects(r => [...batch.map(c => ({ code: c, reason })), ...r].slice(0, 500));
              break;
            }
            setStalled(true);
            await sleep(1000); continue;
          }
          attempt++;
          try {
            const res = await api.reportingScan(projectId, batch);
            applyState(res.state);
            setStalled(false);
            const bad = res.results.filter(r => !r.accepted);
            if (bad.length) {
              setRejects(r => [
                ...bad.map(b => ({ code: b.code, reason: b.reason })), ...r,
              ].slice(0, 500));
              const first = bad[0];
              const kind: Alert["kind"] =
                first.reason.includes("takroriy") ? "duplicate" : "unknown";
              setAlert({ code: first.code, reason: first.reason, kind });
            } else {
              // Clean batch dismisses any lingering banner and shows a hit toast.
              const last = res.results[res.results.length - 1];
              if (last) push("hit", `qabul qilindi: ${last.code}`);
              setAlert(null);
            }
            settled = true;
          } catch (e: any) {
            const status = e?.status as number | undefined;
            if (status && status >= 400 && status < 500) {
              const reason = String(e.message || e);
              push("err", reason);
              setRejects(r => [...batch.map(c => ({ code: c, reason })), ...r].slice(0, 500));
              setStalled(false); settled = true;
            } else if (attempt >= MAX_ATTEMPTS || Date.now() - startedAt > MAX_HOLD_MS) {
              const reason = `ulanish xatosi: ${String(e?.message || e)}`;
              push("err", reason);
              setRejects(r => [...batch.map(c => ({ code: c, reason })), ...r].slice(0, 500));
              setStalled(false); settled = true;
            } else {
              setStalled(true);
              await sleep(backoffMs(attempt));
            }
          }
        }

        queueRef.current.splice(0, items.length);
        setQueued(queueRef.current.length);
        persistQueue();
      }
    } finally {
      drainingRef.current = false;
      setStalled(false);
      scannerRef.current?.focus();
    }
    if (queueRef.current.length) void drain();
  }, [projectId, push, applyState, persistQueue]);

  const handleScan = useCallback((raw: string) => {
    queueRef.current.push({ code: raw });
    setQueued(queueRef.current.length);
    persistQueue();
    void drain();
  }, [drain, persistQueue]);

  // Restore any un-drained codes from localStorage.
  const restoredRef = useRef("");
  useEffect(() => {
    if (restoredRef.current === storageKey) return;
    restoredRef.current = storageKey;
    let codes: string[] = [];
    try { codes = JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { }
    if (!Array.isArray(codes) || !codes.length) return;
    queueRef.current = [
      ...codes.map(c => ({ code: String(c), recovered: true })),
      ...queueRef.current,
    ];
    setQueued(queueRef.current.length);
    push("warn", `${codes.length} ta yuborilmagan skaner tiklandi`);
    void drain();
  }, [storageKey, drain, push]);

  useEffect(() => {
    const goOnline = () => { setOnline(true); void drain(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [drain]);

  async function removeScan(row: ReportScanRow) {
    if (!confirm(`Bu kodni ro'yxatdan o'chiramizmi?\n\n${row.code}`)) return;
    try {
      const s = await api.reportingDeleteScan(projectId, row.id);
      applyState(s); push("hit", `o'chirildi: ${row.code}`);
    } catch (e: any) { push("err", String(e.message || e)); }
    scannerRef.current?.focus();
  }

  async function downloadExcel() {
    setExporting(true);
    try {
      const { blob, filename } = await api.reportingExport(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      push("hit", "Excel yuklab olindi");
    } catch (e: any) {
      push("err", String(e.message || e));
    }
    setExporting(false);
  }

  if (loadingErr) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-danger">{loadingErr}</div>
        <Button className="mt-4" onClick={onExit}><ArrowLeft className="size-4" /> Ortga</Button>
      </div>
    );
  }
  if (!state || !projectMeta) return <div className="p-10 text-center text-muted">Yuklanmoqda…</div>;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      {/* LOUD alert — the operator's primary attention signal */}
      {alert && (
        <div className={cn(
          "mb-4 rounded-2xl border-4 p-5 flex items-start gap-4 shadow-lg",
          alert.kind === "duplicate"
            ? "border-danger bg-danger/10 text-danger animate-pulse"
            : "border-danger bg-danger/10 text-danger",
        )}>
          <AlertTriangle className="size-10 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-2xl font-black uppercase tracking-wide">
              {alert.kind === "duplicate" ? "TAKRORIY KOD" : "SKANERLASHDA XATO"}
            </div>
            <div className="text-lg font-semibold mt-1">{alert.reason}</div>
            <div className="font-mono text-sm mt-1 break-all opacity-80">{alert.code}</div>
          </div>
          <button onClick={() => setAlert(null)}
                  className="p-2 rounded hover:bg-danger/20 shrink-0">
            <X className="size-6" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <button onClick={onExit} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Loyihalar
        </button>
        <div className="text-right">
          <div className="text-2xl font-extrabold tracking-tight text-accent">{projectMeta.name}</div>
          <div className="text-muted text-sm">
            {projectMeta.product_name} · seriya {projectMeta.series || "—"} · {
              projectMeta.report_kind === "km" ? "faqat KM"
              : projectMeta.report_kind === "sscc" ? "faqat SSCC"
              : "KM + SSCC"
            }
          </div>
        </div>
      </div>

      {(!online || stalled) && (
        <div className="mb-4 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="size-5 text-warning shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-warning">
              {online ? "Ulanish sekin — qayta urinilmoqda" : "Internet yo'q"}
            </div>
            <div className="text-muted">
              Skanerlashda davom eting. {queued > 0 ? `${queued} ta kod` : "Kodlar"} saqlanmoqda.
            </div>
          </div>
        </div>
      )}

      <Card className="mb-4">
        <CardHead
          title="Ish holati"
          right={<>
            <Badge tone="accent">hisobot</Badge>
            <Badge tone="accent">{state.total} ta kod</Badge>
          </>}
        />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Jami kodlar" value={state.total} tone="text" />
          <Metric label="KM"           value={state.km_count} tone="success" />
          <Metric label="SSCC (quti)"  value={state.sscc_count} tone="accent" />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
        {/* LEFT: scanner + rejects */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHead title="Skanerlash"
                      right={<Badge tone="accent">
                        {projectMeta.report_kind === "km" ? "KM"
                          : projectMeta.report_kind === "sscc" ? "SSCC"
                          : "KM + SSCC"}
                      </Badge>} />
            <ScanInput
              ref={scannerRef}
              placeholder={
                projectMeta.report_kind === "km"
                  ? "KM skanerlang — bir xil KM ikkinchi marta qabul qilinmaydi"
                  : projectMeta.report_kind === "sscc"
                    ? "SSCC skanerlang — bir xil SSCC ikkinchi marta qabul qilinmaydi"
                    : "KM yoki SSCC skanerlang — bir xil kod ikkinchi marta qabul qilinmaydi"
              }
              tone="accent"
              onScan={handleScan}
            />
            <div className="text-xs text-muted mt-2">
              Bu seriya ichida takrorlanmasin — bir xil kod ikkinchi marta rad etiladi.
              Boshqa qoida yo'q.
            </div>
          </Card>

          <Card>
            <CardHead
              title="Qabul qilinmagan skanerlar"
              right={<>
                {rejects.length > 0 && <Badge tone="danger">{rejects.length}</Badge>}
                {rejects.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setRejects([])}>
                    Tozalash
                  </Button>
                )}
              </>}
            />
            {rejects.length === 0 && (
              <div className="text-muted text-sm italic">Bu seansda rad etilmagan.</div>
            )}
            {rejects.length > 0 && (
              <div className="max-h-64 overflow-auto rounded border border-danger/40 bg-danger/5">
                <ul className="divide-y divide-danger/20">
                  {rejects.map((r, i) => (
                    <li key={i} className="px-2 py-1.5">
                      <div className="font-mono text-[11px] break-all">{r.code}</div>
                      <div className="text-xs text-danger">{r.reason}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT: scanned code list + Excel download */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHead
              title="Skanerlangan kodlar"
              right={<>
                <Badge tone="accent">{state.total}</Badge>
                <Button variant="outline" size="sm" onClick={downloadExcel} disabled={exporting || state.total === 0}>
                  <Download className="size-3" /> {exporting ? "Yuklanmoqda…" : "Excel"}
                </Button>
              </>}
            />
            {state.scans.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-5 text-center text-muted italic text-sm">
                Hali kod skanerlanmagan.
              </div>
            )}
            {state.scans.length > 0 && (
              <div className="max-h-[520px] overflow-auto rounded border border-border">
                <ul className="divide-y divide-border">
                  {state.scans.map(row => (
                    <li key={row.id}
                        className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface2/40">
                      <Badge tone={row.kind === "sscc" ? "accent" : "success"}>
                        {row.kind === "sscc" ? "SSCC" : "KM"}
                      </Badge>
                      <span className="font-mono text-xs break-all flex-1">{row.code}</span>
                      {admin && (
                        <button onClick={() => removeScan(row)}
                                title="O'chirish"
                                className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted hover:text-danger hover:bg-danger/10">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="text-xs text-muted mt-2 flex items-center gap-1.5">
              <Layers className="size-3" />
              Excel fayl nomi mahsulot va seriya bo'yicha shakllantiriladi. SSCC ning boshidagi
              nollar Excel'da yo'qolmaydi.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: "text" | "accent" | "success" | "warning" }) {
  const cls =
    tone === "accent" ? "text-accent"
    : tone === "success" ? "text-success"
    : tone === "warning" ? "text-warning"
    : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={"text-3xl font-extrabold " + cls}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}
