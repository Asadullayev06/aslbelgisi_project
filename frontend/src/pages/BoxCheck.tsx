import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, AlertTriangle, X, Package, ScanBarcode, CheckCircle2,
  Trash2, Lock, Unlock, ClipboardList, Key, ShieldCheck, ShieldAlert, Check,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { ScanInput, type ScanInputHandle } from "@/components/ScanInput";
import { CompanyPicker } from "@/components/CompanyPicker";
import { api } from "@/api";
import { useAuth, isAdmin } from "@/auth";
import type {
  BoxCheckState, BoxCheckSummary, BoxCheckProjectState,
} from "@/types";
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
type Alert = { kind: "duplicate" | "extra" | "unknown"; code: string; reason: string };

/** Scan page for one Quti-tekshiruvi series (project).
 *
 *  Phase A ("no active box"): show project meta + list of past audits +
 *  an SSCC scan input. Scanning an SSCC calls ASL, creates the audit row,
 *  jumps to Phase B.
 *
 *  Phase B ("active box"): live match/extras/missing counters and the
 *  KM scanner. Same batched-serial-idempotent queue as ScanReporting.
 */
export function BoxCheck({ projectId, onExit }: Props) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const { flashes, push, dismiss } = useFlashes();

  const [projectState, setProjectState] = useState<BoxCheckProjectState | null>(null);
  const [projectErr, setProjectErr] = useState<string | null>(null);
  const [state, setState] = useState<BoxCheckState | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [rejects, setRejects] = useState<{ code: string; reason: string }[]>([]);
  const [busyClose, setBusyClose] = useState(false);
  const [ssccInput, setSsccInput] = useState("");
  const [openingBox, setOpeningBox] = useState(false);
  const [openBoxErr, setOpenBoxErr] = useState<string | null>(null);
  const [credsOpen, setCredsOpen] = useState(false);
  const scannerRef = useRef<ScanInputHandle>(null);

  const queueRef = useRef<QItem[]>([]);
  const drainingRef = useRef(false);
  const lastAppliedRef = useRef(Date.now());
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine);
  const [stalled, setStalled] = useState(false);

  const applyState = useCallback((s: BoxCheckState) => {
    setState(s);
    lastAppliedRef.current = Date.now();
  }, []);

  const loadProject = useCallback(() => {
    api.boxCheckGetProject(projectId)
      .then(setProjectState)
      .catch(e => setProjectErr(String(e.message || e)));
  }, [projectId]);
  useEffect(() => { loadProject(); }, [loadProject]);

  const storageKey = state
    ? `mav2.boxcheckq.${state.box.id}.${user?.id ?? "anon"}` : "";
  const persistQueue = useCallback(() => {
    if (!storageKey) return;
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

  useEffect(() => {
    const goOnline = () => { setOnline(true); void drain(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drain = useCallback<() => Promise<void>>(async () => {
    if (drainingRef.current) return;
    if (!state) return;
    drainingRef.current = true;
    const auditId = state.box.id;
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
            const res = await api.boxCheckScan(auditId, batch);
            applyState(res.state);
            setStalled(false);
            const bad = res.results.filter(r => r.verdict !== "match");
            if (bad.length) {
              setRejects(r => [
                ...bad.map(b => ({ code: b.code, reason: b.reason || b.verdict })),
                ...r,
              ].slice(0, 500));
              const first = bad[0];
              const kind: Alert["kind"] =
                first.verdict === "duplicate" ? "duplicate"
                : first.verdict === "extra" ? "extra" : "unknown";
              setAlert({ code: first.code, reason: first.reason || first.verdict, kind });
            } else {
              const last = res.results[res.results.length - 1];
              if (last) push("hit", `mos keldi: ${last.code}`);
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
  }, [state, push, applyState, persistQueue]);

  const handleScan = useCallback((raw: string) => {
    if (!state) return;
    queueRef.current.push({ code: raw });
    setQueued(queueRef.current.length);
    persistQueue();
    void drain();
  }, [state, drain, persistQueue]);

  // Restore any un-drained codes from localStorage when an audit is opened.
  const restoredRef = useRef("");
  useEffect(() => {
    if (!storageKey) return;
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

  async function openBox(rawSscc?: string) {
    const sscc = (rawSscc ?? ssccInput).trim();
    if (!sscc) { setOpenBoxErr("Quti (SSCC) kodini skanerlang"); return; }
    setOpeningBox(true); setOpenBoxErr(null);
    try {
      const s = await api.boxCheckStart(projectId, sscc);
      applyState(s);
      setSsccInput("");
      setRejects([]);
      setAlert(null);
      loadProject();
      push("hit", `Quti ochildi — ${s.box.expected_count} KM kutilmoqda`);
    } catch (e: any) {
      setOpenBoxErr(String(e.message || e));
    } finally {
      setOpeningBox(false);
    }
  }

  async function resumeAudit(id: number) {
    setOpeningBox(true); setOpenBoxErr(null);
    try {
      const s = await api.boxCheckGet(id);
      applyState(s); setRejects([]); setAlert(null);
    } catch (e: any) {
      setOpenBoxErr(String(e.message || e));
    } finally { setOpeningBox(false); }
  }

  async function closeBox() {
    if (!state) return;
    if (!confirm(`Auditni yakunlaymizmi?\n\nMos: ${state.matched_count} / ${state.box.expected_count}` +
                 (state.extra_count ? `\nOrtiqcha: ${state.extra_count}` : "") +
                 (state.missing_count ? `\nYetishmayotgan: ${state.missing_count}` : ""))) return;
    setBusyClose(true);
    try {
      const s = await api.boxCheckClose(state.box.id);
      applyState(s); loadProject();
      push(s.box.status === "closed_ok" ? "hit" : "warn",
           s.box.status === "closed_ok"
             ? "Audit muvaffaqiyatli yopildi"
             : "Audit yopildi — nomuvofiqlik bor");
    } catch (e: any) { push("err", String(e.message || e)); }
    setBusyClose(false);
  }

  async function reopenBox() {
    if (!state) return;
    setBusyClose(true);
    try {
      const s = await api.boxCheckReopen(state.box.id);
      applyState(s); loadProject();
      push("hit", "Audit qayta ochildi");
    } catch (e: any) { push("err", String(e.message || e)); }
    setBusyClose(false);
  }

  function nextBox() {
    setState(null);
    setRejects([]); setAlert(null); queueRef.current = []; setQueued(0);
    setSsccInput("");
  }

  async function removeAudit(row: BoxCheckSummary) {
    if (!confirm(`Bu auditni butunlay o'chiramizmi?\n\nSSCC: ${row.sscc}`)) return;
    try {
      await api.boxCheckDelete(row.id);
      loadProject();
      if (state?.box.id === row.id) nextBox();
      push("hit", "Audit o'chirildi");
    } catch (e: any) { push("err", String(e.message || e)); }
  }

  if (projectErr) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-danger">{projectErr}</div>
        <Button className="mt-4" onClick={onExit}><ArrowLeft className="size-4" /> Ortga</Button>
      </div>
    );
  }
  if (!projectState) return <div className="p-10 text-center text-muted">Yuklanmoqda…</div>;

  if (!state) return renderPhaseA();
  return renderPhaseB();

  function renderPhaseA() {
    if (!projectState) return null;
    const { project, audits } = projectState;
    return (
      <div className="mx-auto max-w-5xl px-6 py-6">
        <Toaster flashes={flashes} onDismiss={dismiss} />
        <button onClick={onExit}
                className="text-muted hover:text-text inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="size-4" /> Loyihalar
        </button>

        <div className="mb-6 flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <div className="text-3xl font-extrabold tracking-tight text-accent2">
              {project.name}
            </div>
            <div className="text-muted text-sm mt-1">
              {project.product_name} · seriya {project.series || "—"} · INN {project.asl_check_inn}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {admin && (
              <Button variant="outline" size="sm" onClick={() => setCredsOpen(true)}>
                <Key className="size-3" /> API kalitni yangilash
              </Button>
            )}
            <Badge tone="accent">Quti tekshiruvi</Badge>
          </div>
        </div>

        {credsOpen && (
          <UpdateCredsModal
            projectId={projectId}
            currentInn={project.asl_check_inn}
            onClose={() => setCredsOpen(false)}
            onSaved={() => { setCredsOpen(false); loadProject();
                             push("hit", "API kalit yangilandi"); }}
          />
        )}

        <Card className="mb-4">
          <CardHead title="Yangi qutini skanerlash"
                    right={<Badge tone="accent">SSCC · 20 raqamli</Badge>} />
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-start">
            <ScanInput
              placeholder="SSCC ni skanerlang yoki qo'lda kiriting"
              tone="accent"
              disabled={openingBox}
              onScan={raw => { setSsccInput(raw); void openBox(raw); }}
            />
            <Button variant="primary" size="lg" onClick={() => openBox()}
                    disabled={openingBox || !ssccInput.trim()}>
              <Package className="size-4" /> {openingBox ? "Ochilmoqda…" : "Qutini ochish"}
            </Button>
          </div>
          {openBoxErr && (
            <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {openBoxErr}
            </div>
          )}
          <div className="text-xs text-muted mt-3">
            SSCC yuborilgach ASL <b>egalik va bolalar</b> so'rovi yuboriladi. Agar quti
            bu kompaniyaga tegishli bo'lmasa yoki ASL da topilmasa — rad etiladi.
          </div>
        </Card>

        <Card>
          <CardHead title="Bu seriyadagi audit-lar"
                    right={<Badge tone="neutral">{audits.length}</Badge>} />
          {audits.length === 0 && (
            <div className="text-muted text-sm py-6 text-center italic">
              Hali biror quti tekshirilmagan.
            </div>
          )}
          {audits.length > 0 && (
            <ul className="divide-y divide-border rounded border border-border">
              {audits.map(r => (
                <li key={r.id}
                    className="group flex items-center gap-3 px-3 py-2 hover:bg-surface2/40">
                  <ClipboardList className="size-4 text-accent2 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs break-all">{r.sscc}</div>
                    <div className="text-[11px] text-muted truncate">
                      {r.expected_count} KM · {new Date(r.opened_at).toLocaleString()}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                  <Button variant="outline" size="sm" onClick={() => resumeAudit(r.id)}>
                    Ochish
                  </Button>
                  {admin && (
                    <button onClick={() => removeAudit(r)} title="O'chirish"
                            className="p-1.5 rounded text-muted hover:text-danger hover:bg-danger/10">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  function renderPhaseB() {
    if (!state || !projectState) return null;
    const box = state.box;
    const project = projectState.project;
    const done = state.matched_count === box.expected_count && state.extra_count === 0;
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <Toaster flashes={flashes} onDismiss={dismiss} />

        {alert && (
          <div className={cn(
            "mb-4 rounded-2xl border-4 p-5 flex items-start gap-4 shadow-lg",
            "border-danger bg-danger/10 text-danger",
            alert.kind !== "extra" && "animate-pulse",
          )}>
            <AlertTriangle className="size-10 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-2xl font-black uppercase tracking-wide">
                {alert.kind === "duplicate" ? "TAKRORIY KOD"
                  : alert.kind === "extra" ? "BU QUTIDA YO'Q"
                  : "SKANERLASHDA XATO"}
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
          <button onClick={nextBox}
                  className="text-muted hover:text-text inline-flex items-center gap-1">
            <ArrowLeft className="size-4" /> Boshqa qutini ochish
          </button>
          <div className="text-right">
            <div className="text-2xl font-extrabold tracking-tight text-accent2">
              {box.product_name || project.product_name}
            </div>
            <div className="text-muted text-sm font-mono break-all">SSCC: {box.sscc}</div>
            <div className="text-xs text-muted mt-0.5">
              {project.name} · seriya {project.series || "—"}
              {box.gtin && ` · GTIN ${box.gtin}`} · <StatusBadge status={box.status} />
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
              <Badge tone={done ? "success" : "accent"}>
                {state.matched_count} / {box.expected_count}
              </Badge>
              {state.extra_count > 0 && <Badge tone="danger">+{state.extra_count} ortiqcha</Badge>}
              {state.missing_count > 0 && (
                <Badge tone="warning">{state.missing_count} qolgan</Badge>
              )}
            </>}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Kutilmoqda" value={box.expected_count} tone="text" />
            <Metric label="Mos keldi" value={state.matched_count} tone="success" />
            <Metric label="Ortiqcha" value={state.extra_count} tone="danger" />
            <Metric label="Yetishmayotgan" value={state.missing_count} tone="warning" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 justify-end">
            {box.status === "active" ? (
              <Button variant="primary" size="sm" onClick={closeBox} disabled={busyClose}>
                <Lock className="size-3" /> Auditni yopish
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={reopenBox} disabled={busyClose}>
                  <Unlock className="size-3" /> Qayta ochish
                </Button>
                <Button variant="primary" size="sm" onClick={nextBox}>
                  <ScanBarcode className="size-3" /> Yangi quti
                </Button>
              </>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHead title="KM skanerlash" right={<Badge tone="accent">31 belgili</Badge>} />
              <ScanInput
                ref={scannerRef}
                placeholder={box.status === "active"
                  ? "KM ni skanerlang — u kutilayotgan ro'yxatga solishtiriladi"
                  : "Audit yopilgan — qayta ochsangiz skanerlash mumkin"}
                tone="accent"
                disabled={box.status !== "active"}
                onScan={handleScan}
              />
              <div className="text-xs text-muted mt-2 flex items-start gap-1.5">
                <CheckCircle2 className="size-3 shrink-0 mt-0.5" />
                Mos KM — yashil, ushbu qutida yo'q KM — qizil bilan xato beradi.
                Har bir skaner audit tarixiga yoziladi.
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

          <div className="flex flex-col gap-4">
            <MissingCard state={state} />
            <ExtrasCard state={state} />
          </div>
        </div>
      </div>
    );
  }
}

function MissingCard({ state }: { state: BoxCheckState }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? state.missing : state.missing.slice(0, 20);
  return (
    <Card>
      <CardHead
        title="Yetishmayotgan KM"
        right={<Badge tone={state.missing_count === 0 ? "success" : "warning"}>
          {state.missing_count}
        </Badge>}
      />
      {state.missing_count === 0 ? (
        <div className="text-success text-sm inline-flex items-center gap-1.5">
          <CheckCircle2 className="size-4" /> Barcha KM skanerlangan
        </div>
      ) : (
        <>
          <div className="max-h-64 overflow-auto rounded border border-warning/30">
            <ul className="divide-y divide-warning/20">
              {shown.map(c => (
                <li key={c} className="px-2 py-1 font-mono text-[11px] break-all">{c}</li>
              ))}
            </ul>
          </div>
          {state.missing.length > 20 && (
            <button onClick={() => setExpanded(x => !x)}
                    className="mt-2 text-xs text-accent hover:underline">
              {expanded ? "Yashirish" : `Yana ${state.missing.length - 20} ta ko'rsatish`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function ExtrasCard({ state }: { state: BoxCheckState }) {
  return (
    <Card>
      <CardHead
        title="Ortiqcha (qutida yo'q) KM"
        right={<Badge tone={state.extra_count === 0 ? "success" : "danger"}>
          {state.extra_count}
        </Badge>}
      />
      {state.extra_count === 0 ? (
        <div className="text-success text-sm inline-flex items-center gap-1.5">
          <CheckCircle2 className="size-4" /> Ortiqcha KM yo'q
        </div>
      ) : (
        <div className="max-h-64 overflow-auto rounded border border-danger/40 bg-danger/5">
          <ul className="divide-y divide-danger/20">
            {state.extras.map(c => (
              <li key={c} className="px-2 py-1 font-mono text-[11px] break-all text-danger">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: any =
    status === "closed_ok" ? "success"
    : status === "closed_mismatch" ? "danger"
    : status === "abandoned" ? "neutral"
    : "accent";
  const label =
    status === "active" ? "faol"
    : status === "closed_ok" ? "muvaffaqiyatli"
    : status === "closed_mismatch" ? "nomuvofiqlik"
    : "bekor qilingan";
  return <Badge tone={tone}>{label}</Badge>;
}

function Metric({ label, value, tone }: {
  label: string; value: number | string;
  tone: "text" | "success" | "warning" | "danger";
}) {
  const cls =
    tone === "success" ? "text-success"
    : tone === "warning" ? "text-warning"
    : tone === "danger" ? "text-danger"
    : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={"text-3xl font-extrabold " + cls}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}


/** Admin modal — rotate the series' ASL credentials. Same verify step as
 *  the setup form so a bad pair is caught before it hits the scan path. */
function UpdateCredsModal({ projectId, currentInn, onClose, onSaved }: {
  projectId: number; currentInn: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [inn, setInn] = useState(currentInn || "");
  const [apiKey, setApiKey] = useState("");
  type Verify =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "ok"; expiresOn?: string }
    | { kind: "bad"; reason: string };
  const [verify, setVerify] = useState<Verify>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setVerify({ kind: "idle" }); }, [inn, apiKey]);

  async function verifyCreds() {
    if (!inn.trim() || !apiKey.trim()) {
      setVerify({ kind: "bad", reason: "INN va API kalitni to'ldiring" }); return;
    }
    setVerify({ kind: "checking" });
    try {
      const r = await api.stockVerify(inn.trim(), apiKey.trim());
      if (!r.ok) { setVerify({ kind: "bad", reason: r.error || "kalit qabul qilinmadi" }); return; }
      if (r.tin_correct === false) {
        setVerify({ kind: "bad", reason: "API kalit bu INN ga tegishli emas" }); return;
      }
      setVerify({ kind: "ok", expiresOn: r.expires_on });
    } catch (e: any) {
      setVerify({ kind: "bad", reason: String(e.message || e) });
    }
  }

  async function save() {
    if (!inn.trim() || !apiKey.trim()) { setErr("INN va API kalitni to'ldiring"); return; }
    setBusy(true); setErr(null);
    try {
      await api.boxCheckUpdateCredentials(projectId, {
        inn: inn.trim(), api_key: apiKey.trim(),
      });
      onSaved();
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
         onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold">API kalitni yangilash</div>
            <div className="text-xs text-muted mt-0.5">
              Ushbu seriya uchun ASL kalitini almashtirish. Yangi juftlik saqlashdan
              oldin ASL da tekshiriladi.
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-muted hover:text-text hover:bg-surface2">
            <X className="size-4" />
          </button>
        </div>

        <CompanyPicker
          onPick={(pickedInn, pickedKey) => { setInn(pickedInn); setApiKey(pickedKey); }}
          currentInn={inn} currentKey={apiKey}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted">INN</span>
            <Input value={inn} onChange={e => setInn(e.target.value)} placeholder="STIR / INN" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted">Yangi API kalit</span>
            <Input value={apiKey} onChange={e => setApiKey(e.target.value)}
                   placeholder="Business User API key" />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={verifyCreds}
                  disabled={verify.kind === "checking" || !inn.trim() || !apiKey.trim()}>
            <ShieldCheck className="size-3" />
            {verify.kind === "checking" ? "Tekshirilmoqda…" : "INN va kalitni tekshirish"}
          </Button>
          {verify.kind === "ok" && (
            <div className="inline-flex items-center gap-1.5 text-sm text-success">
              <ShieldCheck className="size-4" />
              <span>Tasdiqlandi{verify.expiresOn ? ` · kalit ${verify.expiresOn} gacha` : ""}</span>
            </div>
          )}
          {verify.kind === "bad" && (
            <div className="inline-flex items-center gap-1.5 text-sm text-danger">
              <ShieldAlert className="size-4" />
              <span>{verify.reason}</span>
            </div>
          )}
        </div>

        {err && (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {err}
          </div>
        )}

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            <X className="size-3.5" /> Bekor
          </Button>
          <Button variant="primary" onClick={save}
                  disabled={busy || !inn.trim() || !apiKey.trim()}>
            <Check className="size-3.5" /> {busy ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        </div>
      </div>
    </div>
  );
}
