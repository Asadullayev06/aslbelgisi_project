import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Undo2, PackageMinus, AlertTriangle, ChevronDown, ChevronRight,
  X, Trash2, Sparkles, Download,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { ScanInput, type ScanInputHandle } from "@/components/ScanInput";
import { api } from "@/api";
import { useAuth, isAdmin } from "@/auth";
import type { BoxContents, ClosedBox, ScanEventOut, ScanState } from "@/types";
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

/** Inventory scanning: no capacity, no loose, no submit. Same queue/persist/
 *  retry machinery as aggregation because we didn't want to duplicate it, but
 *  the visible UI is stripped and the alerts are LOUD (per operator request:
 *  a big red banner, not a corner toast, for rejects and extras). */
export function ScanInventory({ projectId, onExit }: Props) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [state, setState] = useState<ScanState | null>(null);
  const [loadingErr, setLoadingErr] = useState<string | null>(null);
  const { flashes, push, dismiss } = useFlashes();
  const scannerRef = useRef<ScanInputHandle>(null);

  // Queue plumbing (mirrors Scan.tsx).
  const queueRef = useRef<QItem[]>([]);
  const drainingRef = useRef(false);
  const lastAppliedRef = useRef(Date.now());
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine);
  const [stalled, setStalled] = useState(false);

  // Loud alert bar for rejects/extras — the OPERATOR-facing surface.
  type Alert = { code: string; reason: string; kind: "extra" | "duplicate" | "unknown" };
  const [alert, setAlert] = useState<Alert | null>(null);

  // Session rejects (still visible in a small list below).
  const [rejects, setRejects] = useState<{ code: string; reason: string }[]>([]);

  // Server audit log for old rejects.
  const [history, setHistory] = useState<ScanEventOut[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Cache of already-fetched closed-box contents (fetch on expand).
  const [expanded, setExpanded] = useState<Record<number, BoxContents | "loading" | "err">>({});

  const applyState = useCallback((s: ScanState) => {
    setState(s);
    lastAppliedRef.current = Date.now();
  }, []);

  // ── queue persistence (keyed per project + user, like aggregation) ──
  const storageKey = `mav2.invq.${projectId}.${user?.id ?? "anon"}`;
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

  // Adaptive poll — same shape as aggregation.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (force = false) => {
      if (!force && drainingRef.current) return;
      if (!force && typeof navigator !== "undefined" && !navigator.onLine) return;
      const startedAt = Date.now();
      api.getProject(projectId)
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
            const res = await api.scanBatch(
              projectId, batch, isRecovered ? Math.max(2, attempt) : attempt);
            applyState(res.state);
            setStalled(false);
            const bad = res.results.filter(r => r.level !== "hit");
            if (bad.length) {
              setRejects(r => [
                ...bad.map(b => ({ code: b.code, reason: b.message })), ...r,
              ].slice(0, 500));
              // Big red banner: show the FIRST bad code in this batch so
              // the operator can act. It stays until dismissed or replaced.
              const first = bad[0];
              // Server tells us via message text; try to classify for the
              // banner tone. "RO'YXATDA YO'Q" = extra (warn), "takroriy" =
              // duplicate, else generic.
              const msg = first.message;
              const kind: Alert["kind"] =
                msg.includes("RO'YXATDA YO'Q") ? "extra"
                : msg.includes("takroriy") || msg.includes("ishlatilgan") ? "duplicate"
                : "unknown";
              setAlert({ code: first.code, reason: first.message, kind });
            }
            const last = res.results[res.results.length - 1];
            if (bad.length === 0) {
              if (last) push("hit", last.message);
              // A clean batch dismisses any lingering banner.
              setAlert(null);
            }
            settled = true;
          } catch (e: any) {
            const status = e?.status as number | undefined;
            if (status && status >= 400 && status < 500) {
              const reason = String(e.message || e);
              push("err", reason);
              setRejects(r => [...batch.map(c => ({ code: c, reason })), ...r].slice(0, 500));
              setStalled(false);
              settled = true;
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

  // Restore from localStorage.
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

  async function doUndo() {
    try { const r = await api.undo(projectId); applyState(r.state); push(r.level, r.message); }
    catch (e: any) { push("err", String(e.message || e)); }
    scannerRef.current?.focus();
  }
  async function doDiscard() {
    if (!confirm("Joriy qutini tozalash — bunda kodlar ro'yxatga qaytadi (ekstralar o'chiriladi). Davom etamizmi?")) return;
    try { const r = await api.discard(projectId); applyState(r.state); push(r.level, r.message); }
    catch (e: any) { push("err", String(e.message || e)); }
    scannerRef.current?.focus();
  }
  async function deleteBox(id: number) {
    if (!confirm("Bu qutini bekor qilamizmi?")) return;
    try { const r = await api.deleteBox(projectId, id); applyState(r.state); push(r.level, r.message); }
    catch (e: any) { push("err", String(e.message || e)); }
  }

  async function toggleBox(box: ClosedBox) {
    const cur = expanded[box.id];
    if (cur && cur !== "err") {
      setExpanded(x => { const n = { ...x }; delete n[box.id]; return n; });
      return;
    }
    setExpanded(x => ({ ...x, [box.id]: "loading" }));
    try {
      const c = await api.boxContents(projectId, box.id);
      setExpanded(x => ({ ...x, [box.id]: c }));
    } catch (e: any) {
      push("err", String(e.message || e));
      setExpanded(x => ({ ...x, [box.id]: "err" }));
    }
  }

  async function loadHistory() {
    setHistoryBusy(true);
    try { setHistory(await api.scanEvents(projectId, "err", 300)); }
    catch (e: any) { push("err", String(e.message || e)); }
    setHistoryBusy(false);
  }

  /** Download the inventory as .xlsx (KM → mother SSCC → mos/ekstra → series).
   *  Endpoint is read-only, so this cannot damage project data. */
  async function downloadExcel() {
    setExporting(true);
    try {
      const blob = await api.inventoryExport(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (state?.project.name || `loyiha-${projectId}`).replace(/[^A-Za-z0-9._-]+/g, "_");
      a.download = `inventar_${safe}.xlsx`;
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
  if (!state) return <div className="p-10 text-center text-muted">Yuklanmoqda…</div>;

  const p = state.project;
  const invSeries = p.inventory_series || [];

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      {/* LOUD alert — the operator's primary attention signal */}
      {alert && (
        <div className={cn(
          "mb-4 rounded-2xl border-4 p-5 flex items-start gap-4 shadow-lg",
          alert.kind === "extra"
            ? "border-danger bg-danger/15 text-danger animate-pulse"
            : "border-danger bg-danger/10 text-danger",
        )}>
          <AlertTriangle className="size-10 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-2xl font-black uppercase tracking-wide">
              {alert.kind === "extra"    && "RO'YXATDA YO'Q KOD"}
              {alert.kind === "duplicate" && "TAKRORIY YOKI IShLATILGAN KOD"}
              {alert.kind === "unknown"   && "SKANERLASHDA XATO"}
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
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-extrabold tracking-tight text-warning">{p.name}</div>
            <div className="text-muted text-sm">{p.product_name} · inventarizatsiya</div>
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
            <Badge tone="warning">inventarizatsiya</Badge>
            <Badge tone="accent">{state.closed_boxes.length} yopilgan quti</Badge>
          </>}
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Yuklangan (distinct)" value={state.total_km} tone="text" />
          <Metric label="Skanerlangan"         value={state.scanned_km} tone="success" />
          <Metric label="Qolgan reja"          value={state.pending_km} tone="warning" />
          <Metric label="Seriya soni"          value={invSeries.length} tone="accent" />
        </div>
        {invSeries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {invSeries.map(s => (
              <Badge key={s} tone="warning">{s}</Badge>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHead title="Skanerlash" right={<Badge tone="warning">KM / SSCC</Badge>} />
            <ScanInput
              ref={scannerRef}
              placeholder="KM yoki quti (SSCC) skanerlang — cheklov yo'q, quti to'lganda SSCC skaneriang"
              tone="warning"
              onScan={handleScan}
              disabled={p.status !== "active"}
            />
            <div className="text-xs text-muted mt-2">
              Cheksiz skanerlash — quti to'lganda SSCC ni skanerlang, quti yopiladi va keyingi qutiga o'tasiz.
            </div>

            <div className="flex items-baseline justify-between mt-4 mb-2">
              <div className="text-3xl font-extrabold text-warning">
                {state.current_codes.length}
                <span className="text-muted text-lg"> ta joriy qutida</span>
                {queued > 0 && <span className="ml-2 text-base font-semibold">+{queued} navbatda…</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <Button variant="outline" onClick={doUndo}
                      disabled={state.current_codes.length === 0}>
                <Undo2 className="size-3" /> Oxirgisini o'chirish
              </Button>
              <Button variant="danger" onClick={doDiscard}
                      disabled={state.current_codes.length === 0}>
                <PackageMinus className="size-3" /> Joriy qutini tozalash
              </Button>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Qabul qilinmagan skanerlar"
              right={<>
                {rejects.length > 0 && <Badge tone="danger">{rejects.length}</Badge>}
                <Button variant="outline" size="sm" onClick={loadHistory} disabled={historyBusy}>
                  {historyBusy ? "…" : "Tarix"}
                </Button>
                {rejects.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setRejects([])}>Tozalash</Button>
                )}
              </>}
            />
            {rejects.length === 0 && !history && (
              <div className="text-sm text-muted italic">Bu seansda rad etilmagan.</div>
            )}
            {rejects.length > 0 && (
              <div className="max-h-56 overflow-auto space-y-1">
                {rejects.map((r, i) => (
                  <div key={`${r.code}-${i}`}
                       className="rounded-lg border border-danger/30 bg-danger/5 px-2 py-1.5">
                    <div className="font-mono text-xs break-all">{r.code}</div>
                    <div className="text-xs text-danger mt-0.5">{r.reason}</div>
                  </div>
                ))}
              </div>
            )}
            {history && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-widest text-muted mb-1">
                  Server tarixi ({history.length})
                </div>
                <div className="max-h-56 overflow-auto space-y-1">
                  {history.map(h => (
                    <div key={h.id} className="rounded-lg border border-border bg-surface2/40 px-2 py-1.5">
                      <div className="font-mono text-xs break-all">{h.raw_code || h.km_code}</div>
                      <div className="text-xs text-danger mt-0.5">{h.reason}</div>
                      <div className="text-[10px] text-muted mt-0.5">
                        {h.username || "—"} · {new Date(h.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHead
              title="Yopilgan qutilar"
              right={
                <>
                  <Badge tone="accent">{state.closed_boxes.length}</Badge>
                  <Button variant="outline" size="sm"
                          onClick={downloadExcel}
                          disabled={exporting || state.closed_boxes.length === 0}
                          title="Har bir KM kodi va ona qutisi (SSCC) bilan Excel">
                    <Download className="size-3" />
                    {exporting ? "Tayyorlanmoqda…" : "Excel"}
                  </Button>
                </>
              }
            />
            {state.closed_boxes.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-5 text-center text-muted italic text-sm">
                Hali birorta quti yopilmagan
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {state.closed_boxes.map((b, i) => {
                const cur = expanded[b.id];
                const isOpen = cur && cur !== "err";
                return (
                  <div key={b.id} className="group rounded-lg border border-border overflow-hidden">
                    {/* Row header: the whole area toggles the panel, and
                        admin gets a small trash icon on the right that
                        stops propagation so a delete click does NOT also
                        expand the panel. */}
                    <div className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface2/40">
                      <button
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                        onClick={() => toggleBox(b)}
                      >
                        {isOpen
                          ? <ChevronDown className="size-4 shrink-0" />
                          : <ChevronRight className="size-4 shrink-0" />}
                        <span className="text-sm">Quti {i + 1}</span>
                        <span className="font-mono text-xs text-muted truncate">· {b.sscc}</span>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone="accent">{b.matched_count ?? 0} moslik</Badge>
                        {(b.extra_count ?? 0) > 0 && (
                          <Badge tone="danger">{b.extra_count} ekstra</Badge>
                        )}
                        {admin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteBox(b.id); }}
                            title="Bu qutini o'chirish"
                            className="p-1.5 rounded-md border border-border bg-surface/60
                                       text-muted opacity-70 group-hover:opacity-100
                                       hover:border-danger/60 hover:text-danger hover:bg-danger/10
                                       transition-all"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {isOpen && cur === "loading" && (
                      <div className="p-3 text-sm text-muted italic">Yuklanmoqda…</div>
                    )}
                    {isOpen && cur !== "loading" && typeof cur === "object" && (
                      <BoxContentsPanel box={cur} admin={admin}
                                        onDelete={admin ? () => deleteBox(b.id) : undefined} />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <AiCard state={state} />
        </div>
      </div>
    </div>
  );
}

function BoxContentsPanel({ box, admin, onDelete }: {
  box: BoxContents; admin: boolean; onDelete?: () => void;
}) {
  return (
    <div className="border-t border-border p-3 space-y-3 bg-surface2/20">
      {box.matched.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-success mb-1">
            Ro'yxatga mos ({box.matched.length})
          </div>
          <div className="rounded border border-border bg-surface2/40 max-h-64 overflow-auto">
            <ul className="divide-y divide-border">
              {box.matched.map(m => (
                <li key={m.km_code} className="px-2 py-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs break-all">{m.km_code}</span>
                  <span className="text-xs text-muted shrink-0">
                    {m.matched_series.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {box.extras.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-danger mb-1">
            RO'YXATDA YO'Q — EKSTRA ({box.extras.length})
          </div>
          <div className="rounded border border-danger/40 bg-danger/5 max-h-64 overflow-auto">
            <ul className="divide-y divide-danger/20">
              {box.extras.map(m => (
                <li key={m.km_code} className="px-2 py-1.5 font-mono text-xs break-all">
                  {m.km_code}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {admin && onDelete && (
        <div className="flex justify-end">
          <Button variant="danger" size="sm" onClick={onDelete}>
            <Trash2 className="size-3" /> Qutini bekor qilish
          </Button>
        </div>
      )}
    </div>
  );
}

function AiCard({ state }: { state: ScanState }) {
  // Simple inline stats — no AI call, just numbers rolled up from state.
  const totalScannedDistinct = state.aggregated_km + (state.current_codes.length);
  // total_km on the state is planned-distinct; scanned that were NOT
  // planned = extras across boxes + extras in the open box.
  const extras = state.closed_boxes.reduce((a, b) => a + (b.extra_count ?? 0), 0);
  return (
    <Card>
      <CardHead title="Tahlil"
                right={<Badge tone="warning"><Sparkles className="size-3" /> jonli</Badge>} />
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Reja bo'yicha yuklangan"  value={state.total_km} tone="text" />
        <Metric label="Ombordan skanerlangan"    value={totalScannedDistinct} tone="success" />
        <Metric label="Ro'yxatdan mos"           value={state.aggregated_km - extras} tone="success" />
        <Metric label="Ekstra (ro'yxatda yo'q)"  value={extras} tone={extras ? "danger" : "text"} />
      </div>
      <div className="text-xs text-muted mt-3">
        Har bir quti ochilganda ro'yxatga mos va ekstra kodlar alohida ko'rinadi.
      </div>
    </Card>
  );
}

function Metric({ label, value, tone }: {
  label: string; value: number | string;
  tone: "text" | "accent" | "warning" | "success" | "danger";
}) {
  const cls = tone === "accent"  ? "text-accent"
            : tone === "warning" ? "text-warning"
            : tone === "success" ? "text-success"
            : tone === "danger"  ? "text-danger" : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={`text-2xl font-extrabold ${cls}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}
